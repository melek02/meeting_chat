export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

export type MeetingParticipant = {
  id: string;
  displayName: string;
  muted: boolean;
  socketId?: string | null;
  leftAt?: string | null;
};

export type Meeting = {
  id: string;
  code: string;
  title: string;
  isActive: boolean;
  participants: MeetingParticipant[];
};

export type TranscriptTurn = {
  turnId: string;
  participantId: string;
  participantName: string;
  sequenceNumber: number;
  speechStartTime: number;
  speechEndTime?: number;
  text: string;
  isFinal: boolean;
  status: "PENDING" | "PARTIAL" | "FINAL" | "FAILED";
  chunkIndex: number;
};

export type TranscriptSnapshot = {
  meetingId: string;
  meetingCode: string;
  items: TranscriptTurn[];
  queueDepth: number;
  mergedAt: number;
};

export type RoomStatePayload = {
  participants: MeetingParticipant[];
  peers: Array<{
    socketId: string;
  }>;
};

export type TranscriptHistoryTurn = {
  id: string;
  sequenceNumber: number;
  speechStartTime: string;
  speechEndTime: string | null;
  status: TranscriptTurn["status"];
  latestText: string;
  meetingParticipant: {
    id: string;
    displayName: string;
  };
};
