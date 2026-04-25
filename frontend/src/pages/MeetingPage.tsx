import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";
import type {
  Meeting,
  MeetingParticipant,
  RoomStatePayload,
  TranscriptHistoryTurn,
  TranscriptSnapshot,
  TranscriptTurn,
} from "../types";

type RemoteStreamEntry = {
  socketId: string;
  stream: MediaStream;
};

type LocalTurnState = {
  turnId: string;
  speechStartTime: number;
  chunkIndex: number;
};

type SpeechDebugState = {
  heardText: string;
  lastEmittedText: string;
  lastResultType: "partial" | "final" | "none";
  lastEventAt: number | null;
  emissionCount: number;
  lifecycleEvent: string;
};


export function MeetingPage() {
  const { code = "" } = useParams();
  const meetingCode = code.toUpperCase();
  const navigate = useNavigate();
  const { token, user } = useAuth();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [speechText, setSpeechText] = useState(
    "I started speaking earlier, but a shorter later sentence may complete first."
  );
  const [segmentCount, setSegmentCount] = useState(3);
  const [startDelayMs, setStartDelayMs] = useState(0);
  const [chunkDelayMs, setChunkDelayMs] = useState(400);
  const [finalDelayMs, setFinalDelayMs] = useState(250);
  const [failMode, setFailMode] = useState<"none" | "partial" | "final">("none");
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [splitScreen, setSplitScreen] = useState(false);
  const [queueDepth, setQueueDepth] = useState(0);
  const [error, setError] = useState("");
  const [rtcConfiguration, setRtcConfiguration] = useState<RTCConfiguration>({ iceServers: [] });
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreamEntry[]>([]);
  const [speechRecognitionAvailable, setSpeechRecognitionAvailable] = useState(false);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
  const [transcriptionState, setTranscriptionState] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [speechDebug, setSpeechDebug] = useState<SpeechDebugState>({
    heardText: "",
    lastEmittedText: "",
    lastResultType: "none",
    lastEventAt: null,
    emissionCount: 0,
    lifecycleEvent: "idle",
  });

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const localTurnRef = useRef<LocalTurnState | null>(null);
  const recognitionRunningRef = useRef(false);
  const transcriptionDesiredRef = useRef(false);
  const manualStopRef = useRef(false);
  const tokenRef = useRef<string | null>(token);
  const meetingCodeRef = useRef(meetingCode);
  const meetingReadyRef = useRef(false);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    meetingCodeRef.current = meetingCode;
  }, [meetingCode]);

  useEffect(() => {
    meetingReadyRef.current = Boolean(meeting);
  }, [meeting]);

  useEffect(() => {
  async function loadRtcConfig() {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/rtc-config`
      );
      const data = await res.json() as { iceServers: RTCIceServer[] };
      setRtcConfiguration({ iceServers: data.iceServers });
    } catch {
      setRtcConfiguration({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
    }
  }
  void loadRtcConfig();
}, []);

  useEffect(() => {
    if (!token) {
      return;
    }

        async function loadMeeting() {
          if (!token) return;
          try {
            await api.joinMeeting(token, code);
        const [meetingResponse, transcriptResponse] = await Promise.all([
          api.getMeeting(token, code),
          api.getTranscript(token, code),
        ]);

        setMeeting(meetingResponse);
        setParticipants(meetingResponse.participants);
        setTranscript(
          transcriptResponse.map((turn: TranscriptHistoryTurn) => ({
            turnId: turn.id,
            participantId: turn.meetingParticipant.id,
            participantName: turn.meetingParticipant.displayName,
            sequenceNumber: turn.sequenceNumber,
            speechStartTime: new Date(turn.speechStartTime).getTime(),
            speechEndTime: turn.speechEndTime ? new Date(turn.speechEndTime).getTime() : undefined,
            text: turn.latestText,
            isFinal: turn.status === "FINAL",
            status: turn.status,
            chunkIndex: 0,
          }))
        );
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load meeting");
      }
    }

    void loadMeeting();
  }, [code, token]);

  useEffect(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setSpeechRecognitionAvailable(Boolean(SpeechRecognitionCtor));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function prepareLocalMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        setLocalStream(stream);
      } catch (mediaError) {
        setError(mediaError instanceof Error ? mediaError.message : "Unable to access camera/microphone");
      }
    }

    void prepareLocalMedia();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!localVideoRef.current || !localStream) {
      return;
    }

    localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!token || !meetingCode || !localStream) {
      return;
    }
    if (!rtcConfiguration.iceServers?.length) return;

    const socket = getSocket(token);

    const resetPeerConnections = () => {
      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      pendingIceCandidatesRef.current.clear();
      setRemoteStreams([]);
    };

    const ensurePeerConnection = async (targetSocketId: string, shouldCreateOffer: boolean) => {
  if (peerConnectionsRef.current.has(targetSocketId)) {
    return peerConnectionsRef.current.get(targetSocketId)!;
  }

  const peerConnection = new RTCPeerConnection(rtcConfiguration);

  // Create one MediaStream per peer, attach tracks as they arrive
  const remoteStream = new MediaStream();

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    event.track.onunmute = () => {
      remoteStream.addTrack(event.track);
      setRemoteStreams((current) => {
        const exists = current.find((e) => e.socketId === targetSocketId);
        if (exists) {
          return current.map((e) =>
            e.socketId === targetSocketId
              ? { ...e, stream: remoteStream }
              : e
          );
        }
        return [...current, { socketId: targetSocketId, stream: remoteStream }];
      });
    };

    // Also add immediately in case onunmute doesn't fire
    remoteStream.addTrack(event.track);
    setRemoteStreams((current) => {
      const exists = current.find((e) => e.socketId === targetSocketId);
      if (exists) {
        return current.map((e) =>
          e.socketId === targetSocketId
            ? { ...e, stream: remoteStream }
            : e
        );
      }
      return [...current, { socketId: targetSocketId, stream: remoteStream }];
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("webrtc:ice-candidate", {
        code: meetingCode,
        targetSocketId,
        candidate: event.candidate,
      });
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(`ICE state [${targetSocketId}]:`, peerConnection.iceConnectionState);
    if (["disconnected", "failed", "closed"].includes(peerConnection.iceConnectionState)) {
      cleanupPeerConnection(peerConnectionsRef, pendingIceCandidatesRef, setRemoteStreams, targetSocketId);
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state [${targetSocketId}]:`, peerConnection.connectionState);
    if (["disconnected", "failed", "closed"].includes(peerConnection.connectionState)) {
      cleanupPeerConnection(peerConnectionsRef, pendingIceCandidatesRef, setRemoteStreams, targetSocketId);
    }
  };

  peerConnectionsRef.current.set(targetSocketId, peerConnection);

  if (shouldCreateOffer) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("webrtc:offer", {
      code: meetingCode,
      targetSocketId,
      sdp: offer,
    });
  }

  return peerConnection;
};

    const joinRoom = () => {
      socket.emit("meeting:join-room", { code: meetingCode });
    };

    socket.on("connect", () => {
      resetPeerConnections();
      joinRoom();
    });

    socket.on("disconnect", () => {
      resetPeerConnections();
    });

    if (socket.connected) {
      joinRoom();
    }

    socket.on("meeting:room-state", async (roomState: RoomStatePayload) => {
      setParticipants((current) => mergeParticipants(current, roomState.participants));

      for (const peer of roomState.peers) {
        await ensurePeerConnection(peer.socketId, true);
      }
    });

    socket.on("participant:joined", (participant: MeetingParticipant) => {
      setParticipants((current) => mergeParticipants(current, [participant]));
    });

    socket.on("participant:left", (participant: MeetingParticipant) => {
      setParticipants((current) => current.filter((entry) => entry.id !== participant.id));

      if (participant.socketId) {
        cleanupPeerConnection(
          peerConnectionsRef,
          pendingIceCandidatesRef,
          setRemoteStreams,
          participant.socketId
        );
      }
    });

    socket.on("participant:updated", (participant: MeetingParticipant) => {
      setParticipants((current) =>
        current.map((entry) => (entry.id === participant.id ? { ...entry, ...participant } : entry))
      );
    });

    socket.on("active-speaker:changed", ({ participantId }: { participantId: string | null }) => {
      setActiveSpeakerId(participantId);
    });

    socket.on("transcript:snapshot", (snapshot: TranscriptSnapshot) => {
      setTranscript((current) => mergeTranscriptTurns(current, snapshot.items));
      setQueueDepth(snapshot.queueDepth);
    });

    socket.on("transcript:partial", (item: TranscriptTurn) => {
      setTranscript((current) => mergeTranscriptTurns(current, [item]));
    });

    socket.on("transcript:final", (item: TranscriptTurn) => {
      setTranscript((current) => mergeTranscriptTurns(current, [item]));
    });

    socket.on("webrtc:offer", async ({ fromSocketId, sdp }: { fromSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      const peerConnection = await ensurePeerConnection(fromSocketId, false);
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIceCandidates(fromSocketId, peerConnectionsRef.current, pendingIceCandidatesRef.current);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit("webrtc:answer", {
        code: meetingCode,
        targetSocketId: fromSocketId,
        sdp: answer,
      });
    });

    socket.on("webrtc:answer", async ({ fromSocketId, sdp }: { fromSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      const peerConnection = peerConnectionsRef.current.get(fromSocketId);

      if (!peerConnection) {
        return;
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await flushPendingIceCandidates(fromSocketId, peerConnectionsRef.current, pendingIceCandidatesRef.current);
    });

    socket.on("webrtc:ice-candidate", async ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      const peerConnection =
        peerConnectionsRef.current.get(fromSocketId) ?? (await ensurePeerConnection(fromSocketId, false));

      if (!peerConnection.remoteDescription) {
        const current = pendingIceCandidatesRef.current.get(fromSocketId) ?? [];
        pendingIceCandidatesRef.current.set(fromSocketId, [...current, candidate]);
        return;
      }

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (iceError) {
        console.error("failed to add ICE candidate", iceError);
      }
    });

    socket.on("meeting:ended", () => {
      navigate("/home");
    });

    socket.on("error:message", ({ message }: { message: string }) => {
      setError(message);
    });

    return () => {
      socket.emit("meeting:leave-room", { code: meetingCode });
      socket.off("meeting:room-state");
      socket.off("connect");
      socket.off("disconnect");
      socket.off("participant:joined");
      socket.off("participant:left");
      socket.off("participant:updated");
      socket.off("active-speaker:changed");
      socket.off("transcript:snapshot");
      socket.off("transcript:partial");
      socket.off("transcript:final");
      socket.off("webrtc:offer");
      socket.off("webrtc:answer");
      socket.off("webrtc:ice-candidate");
      socket.off("meeting:ended");
      socket.off("error:message");
      resetPeerConnections();
    };
  }, [localStream, meetingCode, navigate, token, rtcConfiguration]);

  useEffect(() => {
    if (!speechRecognitionAvailable || recognitionRef.current) {
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognitionRunningRef.current = true;
      setTranscriptionState("running");
      setError("");
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onstart",
      }));
    };

    recognition.onaudiostart = () => {
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onaudiostart",
      }));
    };

    recognition.onsoundstart = () => {
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onsoundstart",
      }));
    };

    recognition.onspeechstart = () => {
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onspeechstart",
      }));
    };

    recognition.onspeechend = () => {
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onspeechend",
      }));
    };

    recognition.onaudioend = () => {
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onaudioend",
      }));
    };

    recognition.onnomatch = () => {
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onnomatch",
      }));
    };

    recognition.onresult = (event) => {
      setError("");
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onresult",
      }));
      handleRecognitionResult(event, {
        tokenRef,
        meetingCodeRef,
        meetingReadyRef,
        localTurnRef,
        setSpeechDebug,
      });
    };

    recognition.onerror = (event) => {
      recognitionRunningRef.current = false;
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: `onerror:${event.error}`,
      }));
      const recoverableErrors = new Set<SpeechRecognitionErrorEvent["error"]>([
        "aborted",
        "no-speech",
        "audio-capture", // ← only real change for Fix 3
      ]);

      if (recoverableErrors.has(event.error)) {
        setTranscriptionState("starting");
        setError(
          event.error === "no-speech"
            ? "Listening for speech..."
            : event.error === "audio-capture"
              ? "Mic busy, retrying..."
              : "Transcription was interrupted. Restarting..."
        );
        return;
      }

      transcriptionDesiredRef.current = false;
      setTranscriptionState("error");
      setTranscriptionEnabled(false);
      setError(getSpeechRecognitionErrorMessage(event));
    };

    recognition.onend = () => {
      recognitionRunningRef.current = false;
      setSpeechDebug((current) => ({
        ...current,
        lifecycleEvent: "onend",
      }));

      if (manualStopRef.current) {
        manualStopRef.current = false;
        setTranscriptionState("idle");
        return;
      }

      if (transcriptionDesiredRef.current) {
        window.setTimeout(() => {
          void startRecognition(recognitionRef, recognitionRunningRef, setTranscriptionState, setError);
        }, 150);
      } else {
        setTranscriptionState("idle");
      }
    };

    recognitionRef.current = recognition;
    setSpeechDebug((current) => ({
      ...current,
      lifecycleEvent: "recognizer-created",
    }));

    return () => {
      transcriptionDesiredRef.current = false;
      if (recognitionRunningRef.current) {
        recognition.stop();
      }
      recognitionRunningRef.current = false;
      recognitionRef.current = null;
    };
  }, [speechRecognitionAvailable]);

  const sortedTranscript = useMemo(
    () =>
      [...transcript].sort((left, right) => {
        if (left.speechStartTime !== right.speechStartTime) {
          return left.speechStartTime - right.speechStartTime;
        }

        return left.sequenceNumber - right.sequenceNumber;
      }),
    [transcript]
  );

  const localParticipantId = useMemo(
    () => participants.find((participant) => participant.displayName === user?.name)?.id ?? null,
    [participants, user?.name]
  );

  function handleSimulateTurn() {
    if (!token || !meeting) {
      return;
    }

    const socket = getSocket(token);
    socket.emit("transcript:simulate-turn", {
      code: meetingCode,
      text: speechText,
      segmentCount,
      startDelayMs,
      chunkDelayMs,
      finalDelayMs,
      failMode,
    });
  }

  function handleRunDemo() {
    if (!token || !meeting) {
      return;
    }

    getSocket(token).emit("simulation:run-demo", { code: meetingCode });
  }

  function handleHangUp() {
    if (!token || !meeting) {
      return;
    }

    if (recognitionRunningRef.current) {
      recognitionRef.current?.stop();
      recognitionRunningRef.current = false;
    }
    localStream?.getTracks().forEach((track) => track.stop());
    getSocket(token).emit("meeting:leave-room", { code: meetingCode });
    navigate("/home");
  }

  function handleToggleMute() {
    if (!token || !meeting || !localStream) {
      return;
    }

    const nextMuted = !muted;
    setMuted(nextMuted);
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    getSocket(token).emit("participant:toggle-mute", { code: meetingCode });
  }

  function handleToggleTranscription() {
    if (!speechRecognitionAvailable) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    if (!meeting) {
      setError("Meeting is still loading. Wait before starting transcription.");
      return;
    }

    if (!localStream) {
      setError("Microphone stream is not ready yet.");
      return;
    }

    setTranscriptionEnabled((current) => {
      const next = !current;
      transcriptionDesiredRef.current = next;

      if (!next) {
        if (recognitionRunningRef.current) {
          manualStopRef.current = true;
          recognitionRef.current?.stop();
          recognitionRunningRef.current = false;
        }
        setTranscriptionState("idle");
        setError("");
      } else {
        setTranscriptionState("starting");
        setError("");
        setSpeechDebug((currentDebug) => ({
          ...currentDebug,
          lifecycleEvent: "start-button-clicked",
        }));
        void startRecognition(recognitionRef, recognitionRunningRef, setTranscriptionState, setError);
      }

      return next;
    });
  }

  return (
    <div className="meeting-shell">
      <header className="meeting-header">
        <div>
          <h1>{meeting?.title ?? `Meeting ${code}`}</h1>
          <p>
            Code: <strong>{code}</strong> | Queue depth: <strong>{queueDepth}</strong>
          </p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={handleRunDemo}>Run demo scenario</button>
          <button type="button" onClick={handleToggleTranscription}>
            {transcriptionEnabled ? "Stop transcription" : "Start transcription"}
          </button>
        </div>
      </header>

      {error ? <p className="error-text">{error}</p> : null}

      <main className={`meeting-grid ${splitScreen ? "split-screen" : ""}`}>
        <section className="panel participants-panel">
          <h2>Live call</h2>
          <div className="participant-column">
            <article
              className={`participant-tile local-tile ${
                activeSpeakerId && localParticipantId === activeSpeakerId
                  ? "active-speaker"
                  : ""
              }`}
            >
              <video ref={localVideoRef} autoPlay muted playsInline className="participant-video" />
              <div>
                <strong>{user?.name} (You)</strong>
                <p>
                  {muted ? "Muted" : "Mic live"} |{" "}
                  {transcriptionEnabled ? `Transcription ${transcriptionState}` : "Transcription off"}
                </p>
              </div>
            </article>

            {remoteStreams.map((remoteEntry) => {
              const participant = participants.find((entry) => entry.socketId === remoteEntry.socketId);

              return (
                <RemoteVideoCard
                  key={remoteEntry.socketId}
                  stream={remoteEntry.stream}
                  title={participant?.displayName ?? `Peer ${remoteEntry.socketId.slice(0, 6)}`}
                  active={participant?.id === activeSpeakerId}
                />
              );
            })}

            {participants
              .filter((participant) => !participant.socketId && participant.id !== localParticipantId)
              .map((participant) => (
                <article
                  key={participant.id}
                  className={`participant-tile placeholder-tile ${
                    activeSpeakerId === participant.id ? "active-speaker" : ""
                  }`}
                >
                  <div className="participant-avatar">{participant.displayName.slice(0, 1).toUpperCase()}</div>
                  <div>
                    <strong>{participant.displayName}</strong>
                    <p>{participant.muted ? "Muted" : "Connected"}</p>
                  </div>
                </article>
              ))}
          </div>
        </section>

        <section className="panel transcript-panel">
          <h2>Transcript chat</h2>
          <div className="transcript-column">
            {sortedTranscript.map((turn) => (
              <article key={turn.turnId} className={`transcript-item ${turn.isFinal ? "final" : "partial"}`}>
                <div className="transcript-meta">
                  <strong>{turn.participantName}</strong>
                  <span>seq {turn.sequenceNumber}</span>
                  <span>{turn.status}</span>
                </div>
                <p>{turn.text || "<waiting>"}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      

      <section className="panel simulation-panel">
        <h2>Simulation mode</h2>
        <p>
          Real call audio/video runs through WebRTC above. This panel remains for testing uneven worker speeds and
          proving that ordering stays correct even when completion finishes out of order.
        </p>
        <textarea value={speechText} onChange={(event) => setSpeechText(event.target.value)} rows={4} />
        <div className="simulation-grid">
          <label>
            <span>Start delay</span>
            <input
              type="number"
              value={startDelayMs}
              onChange={(event) => setStartDelayMs(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Chunk delay</span>
            <input
              type="number"
              value={chunkDelayMs}
              onChange={(event) => setChunkDelayMs(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Final delay</span>
            <input
              type="number"
              value={finalDelayMs}
              onChange={(event) => setFinalDelayMs(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Segments</span>
            <input
              type="number"
              min={1}
              max={8}
              value={segmentCount}
              onChange={(event) => setSegmentCount(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Failure mode</span>
            <select value={failMode} onChange={(event) => setFailMode(event.target.value as typeof failMode)}>
              <option value="none">none</option>
              <option value="partial">fail after first partial</option>
              <option value="final">fail before final</option>
            </select>
          </label>
        </div>
        <button type="button" className="primary-button" onClick={handleSimulateTurn}>
          Run simulated turn
        </button>
      </section>

      <footer className="controls-bar">
        <button type="button" onClick={handleHangUp}>Hang up</button>
        <button type="button" onClick={handleToggleMute}>{muted ? "Unmute microphone" : "Mute microphone"}</button>
        <button type="button" onClick={() => setFullscreen((current) => !current)}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
        <button type="button" onClick={() => setSplitScreen((current) => !current)}>
          {splitScreen ? "Single screen" : "Split-screen"}
        </button>
        <span className="controls-note">
          {speechRecognitionAvailable
            ? `Browser speech recognition available (${transcriptionState})`
            : "Speech recognition unavailable"}
        </span>
      </footer>
    </div>
  );
}

async function startRecognition(
  recognitionRef: MutableRefObject<SpeechRecognition | null>,
  recognitionRunningRef: MutableRefObject<boolean>,
  setTranscriptionState: Dispatch<SetStateAction<"idle" | "starting" | "running" | "error">>,
  setError: Dispatch<SetStateAction<string>>
) {
  if (recognitionRunningRef.current) {
    return;
  }

  const recognition = recognitionRef.current;

  if (!recognition) {
    setTranscriptionState("error");
    setError("Speech recognition is not initialized yet.");
    return;
  }

  try {
    setTranscriptionState("starting");
    recognition.start();
  } catch (error) {
    recognitionRunningRef.current = false;
    setTranscriptionState("error");
    setError(error instanceof Error ? error.message : "Unable to start transcription.");
  }
}

function handleRecognitionResult(
  event: SpeechRecognitionEvent,
  options: {
    tokenRef: MutableRefObject<string | null>;
    meetingCodeRef: MutableRefObject<string>;
    meetingReadyRef: MutableRefObject<boolean>;
    localTurnRef: MutableRefObject<LocalTurnState | null>;
    setSpeechDebug: Dispatch<SetStateAction<SpeechDebugState>>;
  }
) {
  const { tokenRef, meetingCodeRef, meetingReadyRef, localTurnRef, setSpeechDebug } = options;
  const token = tokenRef.current;
  const meetingCode = meetingCodeRef.current;

  if (!token || !meetingCode) {
    return;
  }

  const socket = getSocket(token);

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcriptText = result[0]?.transcript?.trim();

    if (!transcriptText) {
      continue;
    }

    setSpeechDebug((current) => ({
      ...current,
      heardText: transcriptText,
      lastResultType: result.isFinal ? "final" : "partial",
      lastEventAt: Date.now(),
    }));

    if (!localTurnRef.current) {
      localTurnRef.current = {
        turnId: crypto.randomUUID(),
        speechStartTime: Date.now(),
        chunkIndex: 0,
      };
    }

    const localTurn = localTurnRef.current;

    socket.emit("transcript:ingest", {
      code: meetingCode,
      turnId: localTurn.turnId,
      speechStartTime: localTurn.speechStartTime,
      speechEndTime: result.isFinal ? Date.now() : undefined,
      chunkIndex: localTurn.chunkIndex,
      text: transcriptText,
      isFinal: result.isFinal,
      processingDelayMs: 0,
    });

    setSpeechDebug((current) => ({
      ...current,
      lastEmittedText: transcriptText,
      lastResultType: result.isFinal ? "final" : "partial",
      lastEventAt: Date.now(),
      emissionCount: current.emissionCount + 1,
      lifecycleEvent: "transcript:ingest emitted",
    }));

    localTurn.chunkIndex += 1;

    if (result.isFinal) {
      localTurnRef.current = null;
    }
  }
}

function getSpeechRecognitionErrorMessage(event: SpeechRecognitionErrorEvent) {
  switch (event.error) {
    case "audio-capture":
      return "Speech recognition could not access your microphone.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech-recognition permission was denied.";
    case "network":
      return "Speech recognition hit a network error. Try again.";
    case "language-not-supported":
      return "This browser does not support the selected speech-recognition language.";
    case "aborted":
      return "Speech recognition was interrupted.";
    case "no-speech":
      return "No speech detected yet.";
    default:
      return event.message || "Speech recognition failed. Transcription stopped.";
  }
}

function mergeParticipants(current: MeetingParticipant[], incoming: MeetingParticipant[]) {
  const byId = new Map(current.map((participant) => [participant.id, participant]));

  incoming.forEach((participant) => {
    const existing = byId.get(participant.id);
    byId.set(participant.id, {
      ...existing,
      ...participant,
    });
  });

  return Array.from(byId.values());
}

function mergeTranscriptTurns(current: TranscriptTurn[], incoming: TranscriptTurn[]) {
  const byTurnId = new Map(current.map((turn) => [turn.turnId, turn]));

  incoming.forEach((turn) => {
    const existing = byTurnId.get(turn.turnId);
    byTurnId.set(turn.turnId, {
      ...existing,
      ...turn,
    });
  });

  return Array.from(byTurnId.values()).sort((left, right) => {
    if (left.speechStartTime !== right.speechStartTime) {
      return left.speechStartTime - right.speechStartTime;
    }

    return left.sequenceNumber - right.sequenceNumber;
  });
}

function cleanupPeerConnection(
  peerConnectionsRef: MutableRefObject<Map<string, RTCPeerConnection>>,
  pendingIceCandidatesRef: MutableRefObject<Map<string, RTCIceCandidateInit[]>>,
  setRemoteStreams: Dispatch<SetStateAction<RemoteStreamEntry[]>>,
  targetSocketId: string
) {
  const peerConnection = peerConnectionsRef.current.get(targetSocketId);

  if (peerConnection) {
    peerConnection.close();
    peerConnectionsRef.current.delete(targetSocketId);
  }

  pendingIceCandidatesRef.current.delete(targetSocketId);
  setRemoteStreams((current) => current.filter((entry) => entry.socketId !== targetSocketId));
}

async function flushPendingIceCandidates(
  targetSocketId: string,
  peerConnections: Map<string, RTCPeerConnection>,
  pendingIceCandidates: Map<string, RTCIceCandidateInit[]>
) {
  const peerConnection = peerConnections.get(targetSocketId);

  if (!peerConnection?.remoteDescription) {
    return;
  }

  const queuedCandidates = pendingIceCandidates.get(targetSocketId);

  if (!queuedCandidates?.length) {
    return;
  }

  pendingIceCandidates.delete(targetSocketId);

  for (const candidate of queuedCandidates) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (iceError) {
      console.error("failed to flush queued ICE candidate", iceError);
    }
  }
}

function RemoteVideoCard({
  stream,
  title,
  active,
}: {
  stream: MediaStream;
  title: string;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    const audioElement = audioRef.current;

    if (videoElement) {
      videoElement.srcObject = stream;
      videoElement.muted = true;
      void videoElement.play().catch(() => undefined);
    }

    if (audioElement) {
      audioElement.srcObject = stream;
      audioElement.muted = false;
      void audioElement.play().catch(() => undefined);
    }
  }, [stream]);

  return (
    <article className={`participant-tile ${active ? "active-speaker" : ""}`}>
      <video ref={videoRef} autoPlay playsInline className="participant-video" />
      <audio ref={audioRef} autoPlay playsInline />
      <div>
        <strong>{title}</strong>
        <p>Remote live stream</p>
      </div>
    </article>
  );
}
