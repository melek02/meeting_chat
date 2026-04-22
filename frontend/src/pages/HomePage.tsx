import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

export function HomePage() {
  const { token, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [meetingCode, setMeetingCode] = useState("");
  const [error, setError] = useState("");

  async function handleCreateMeeting() {
    if (!token) {
      return;
    }

    try {
      const meeting = await api.createMeeting(token);
      navigate(`/meeting/${meeting.code}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create meeting failed");
    }
  }

  async function handleJoinMeeting() {
    if (!token) {
      return;
    }

    try {
      await api.joinMeeting(token, meetingCode);
      navigate(`/meeting/${meetingCode.toUpperCase()}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Join meeting failed");
    }
  }

  return (
    <div className="page-shell">
      <div className="home-card">
        <div className="home-header">
          <div>
            <h1>Meetings</h1>
            <p>Signed in as {user?.name}</p>
          </div>
          <button onClick={signOut}>Sign out</button>
        </div>
        <button className="primary-button" onClick={handleCreateMeeting}>
          Create meeting
        </button>
        <input
          placeholder="Enter meeting code"
          value={meetingCode}
          onChange={(event) => setMeetingCode(event.target.value)}
        />
        <button onClick={handleJoinMeeting}>Join meeting</button>
        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </div>
  );
}
