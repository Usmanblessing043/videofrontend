import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from 'react-toastify';
import io from "socket.io-client";
import Peer from "peerjs";
import './RoomMeeting.css';

// Custom hook for socket connection
const useSocket = (url) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    const handleConnect = () => {
      console.log("Connected to server:", newSocket.id);
      setIsConnected(true);
    };

    const handleConnectError = (err) => {
      console.error("Connection error:", err);
      setIsConnected(false);
    };

    const handleDisconnect = (reason) => {
      console.log("Disconnected from server:", reason);
      setIsConnected(false);
    };

    newSocket.on("connect", handleConnect);
    newSocket.on("connect_error", handleConnectError);
    newSocket.on("disconnect", handleDisconnect);

    setSocket(newSocket);

    return () => {
      newSocket.off("connect", handleConnect);
      newSocket.off("connect_error", handleConnectError);
      newSocket.off("disconnect", handleDisconnect);
      newSocket.close();
    };
  }, [url]);

  return { socket, isConnected };
};

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL || "http://localhost:3022";
  const { socket, isConnected } = useSocket(`${backendUrl}/user`);

  const [peers, setPeers] = useState({});
  const myVideo = useRef();
  const peersRef = useRef({});
  const streamRef = useRef(null);
  const peerInstance = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState(1);
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      try {
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 640, height: 480 },
          audio: true 
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        myVideo.current.srcObject = stream;
        streamRef.current = stream;

        // Initialize PeerJS
        peerInstance.current = new Peer({
          config: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:stun1.l.google.com:19302" },
              {
                urls: "turn:relay1.expressturn.com:3478",
                username: "efG3knQJwOqN1HpXj1",
                credential: "8cG2RzTgN5kGv9P4",
              }
            ]
          }
        });

        peerInstance.current.on('open', (id) => {
          console.log("PeerJS connected with ID:", id);
          
          // Join room when both socket and peer are ready
          if (socket) {
            socket.emit("join-room", roomId, id);
          }
        });

        peerInstance.current.on('call', (call) => {
          // Answer the call with your stream
          call.answer(streamRef.current);
          
          // Receive their stream
          call.on('stream', (remoteStream) => {
            if (!peersRef.current[call.peer]) {
              peersRef.current[call.peer] = remoteStream;
              setPeers(prev => ({ ...prev, [call.peer]: remoteStream }));
            }
          });
        });

        peerInstance.current.on('error', (err) => {
          console.error('PeerJS error:', err);
        });

        setMediaError(false);
      } catch (err) {
        console.error("Error initializing:", err);
        toast.error("Could not access camera/microphone. Please check permissions.");
        setMediaError(true);
      }
    };

    initialize();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerInstance.current) {
        peerInstance.current.destroy();
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (!socket) return;

    const handleHost = () => {
      console.log("I am the host");
      setIsHost(true);
    };

    const handleAllUsers = (users) => {
      console.log("All users in room:", users);
      setParticipants(users.length + 1);
      
      // Connect to all existing users
      users.forEach(userId => {
        if (!peersRef.current[userId] && userId !== peerInstance.current.id) {
          connectToPeer(userId);
        }
      });
    };

    const handleUserJoined = (newUserId) => {
      console.log("🆕 User joined:", newUserId);
      setParticipants(prev => prev + 1);
      
      // Connect to the new user
      if (!peersRef.current[newUserId] && newUserId !== peerInstance.current.id) {
        connectToPeer(newUserId);
      }
    };

    const handleUserLeft = (id) => {
      console.log("User left:", id);
      setParticipants(prev => prev - 1);
      
      // Remove peer from state
      if (peersRef.current[id]) {
        delete peersRef.current[id];
        setPeers(prev => {
          const newPeers = { ...prev };
          delete newPeers[id];
          return newPeers;
        });
      }
      
      toast.info(`Participant left the meeting`);
    };

    const handleChatMessage = ({ user, message }) => {
      setMessages((prev) => [...prev, { user, message }]);
    };

    const handleEndCall = () => {
      toast.success("Meeting has ended by host");
      cleanup();
      navigate("/Dashboard");
    };

    // Add event listeners
    socket.on("host", handleHost);
    socket.on("all-users", handleAllUsers);
    socket.on("user-joined", handleUserJoined);
    socket.on("user-left", handleUserLeft);
    socket.on("chat-message", handleChatMessage);
    socket.on("end-call", handleEndCall);

    return () => {
      // Remove event listeners
      socket.off("host", handleHost);
      socket.off("all-users", handleAllUsers);
      socket.off("user-joined", handleUserJoined);
      socket.off("user-left", handleUserLeft);
      socket.off("chat-message", handleChatMessage);
      socket.off("end-call", handleEndCall);
    };
  }, [socket, navigate]);

  const connectToPeer = (userId) => {
    if (!peerInstance.current || !streamRef.current) return;
    
    // Call the user
    const call = peerInstance.current.call(userId, streamRef.current);
    
    // Receive their stream
    call.on('stream', (remoteStream) => {
      peersRef.current[userId] = remoteStream;
      setPeers(prev => ({ ...prev, [userId]: remoteStream }));
    });
    
    call.on('error', (err) => {
      console.error('Call error:', err);
    });
  };

  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].enabled = !audioTracks[0].enabled;
        setIsMuted(!audioTracks[0].enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks[0].enabled = !videoTracks[0].enabled;
        setIsCameraOff(!videoTracks[0].enabled);
      }
    }
  };

  const startScreenShare = async () => {
    try {
      if (isScreenSharing) {
        // Switch back to camera
        myVideo.current.srcObject = streamRef.current;
        setIsScreenSharing(false);
        
        // Stop screen stream
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(track => track.stop());
          screenStreamRef.current = null;
        }
        
        // Update all peers with camera stream
        Object.keys(peersRef.current).forEach(userId => {
          connectToPeer(userId);
        });
      } else {
        // Start screen share
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: "always" }, 
          audio: true 
        });
        screenStreamRef.current = screenStream;

        myVideo.current.srcObject = screenStream;
        setIsScreenSharing(true);

        // Update all peers with screen stream
        Object.keys(peersRef.current).forEach(userId => {
          connectToPeer(userId);
        });

        screenStream.getVideoTracks()[0].onended = () => {
          // Switch back to camera when screen share ends
          myVideo.current.srcObject = streamRef.current;
          setIsScreenSharing(false);
          screenStreamRef.current = null;
          
          // Update all peers with camera stream
          Object.keys(peersRef.current).forEach(userId => {
            connectToPeer(userId);
          });
        };
      }
    } catch (err) {
      console.error("Screen share error:", err);
      toast.error("Failed to share screen");
    }
  };

  const sendMessage = () => {
    if (input.trim() && socket && socket.connected) {
      socket.emit("chat-message", { roomId, user: socket.id, message: input });
      setMessages((prev) => [...prev, { user: "You", message: input, isMe: true }]);
      setInput("");
    } else if (!socket || !socket.connected) {
      toast.error("Cannot send message - not connected to server");
    }
  };

  const endCall = () => {
    if (window.confirm("Are you sure you want to end the call for everyone?")) {
      if (socket && socket.connected) {
        socket.emit("end-call", roomId);
      }
      cleanup();
      navigate("/Dashboard");
    }
  };

  const leaveCall = () => {
    if (window.confirm("Leave the meeting?")) {
      cleanup();
      navigate("/Dashboard");
    }
  };

  const reconnect = () => {
    if (socket && !socket.connected) {
      socket.connect();
    }
    if (peerInstance.current && peerInstance.current.disconnected) {
      peerInstance.current.reconnect();
    }
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (peerInstance.current) {
      peerInstance.current.destroy();
    }
    peersRef.current = {};
    setPeers({});
  };

  if (mediaError) {
    return (
      <div className="error-container">
        <div className="error-content">
          <h2>Camera/Microphone Access Required</h2>
          <p>Please allow access to your camera and microphone to join the meeting.</p>
          <button onClick={() => window.location.reload()} className="retry-btn">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="room-container">
      <header className="room-header">
        <div className="room-info">
          <h2>Meeting: {roomId}</h2>
          <div className="participant-count">
            <i className="fas fa-users"></i> {participants} participants
          </div>
          <div className="connection-info">
            <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? "Connected" : "Disconnected"}
            </div>
            {isHost && <div className="host-indicator">Host</div>}
          </div>
        </div>
        <div className="header-controls">
          {!isConnected && (
            <button onClick={reconnect} className="reconnect-btn">
              <i className="fas fa-sync-alt"></i> Reconnect
            </button>
          )}
          {isHost && (
            <button onClick={endCall} className="end-call-btn">
              <i className="fas fa-phone-slash"></i> End Call
            </button>
          )}
          <button onClick={leaveCall} className="leave-call-btn">
            <i className="fas fa-sign-out-alt"></i> Leave
          </button>
        </div>
      </header>

      <div className="video-container">
        <div className="video-grid">
          <div className="video-item local-video">
            <video ref={myVideo} autoPlay muted playsInline />
            <div className="video-overlay">
              <span>You {isMuted ? " (Muted)" : ""} {isCameraOff ? " (Camera Off)" : ""}</span>
              {isHost && <span className="host-badge">Host</span>}
            </div>
          </div>
          {Object.entries(peers).map(([peerId, stream]) => (
            <Video key={peerId} stream={stream} peerId={peerId} />
          ))}
        </div>

        <div className="controls">
          <button onClick={toggleMute} className={`control-btn ${isMuted ? 'active' : ''}`}>
            <i className={`fas ${isMuted ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          <button onClick={toggleCamera} className={`control-btn ${isCameraOff ? 'active' : ''}`}>
            <i className={`fas ${isCameraOff ? 'fa-video-slash' : 'fa-video'}`}></i>
            {isCameraOff ? 'Camera On' : 'Camera Off'}
          </button>
          <button onClick={startScreenShare} className={`control-btn ${isScreenSharing ? 'active' : ''}`}>
            <i className="fas fa-desktop"></i>
            {isScreenSharing ? 'Stop Share' : 'Share Screen'}
          </button>
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-header">
          <h3>Chat</h3>
          <div className="chat-indicator">{messages.length} messages</div>
        </div>
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.isMe ? 'my-message' : 'their-message'}`}>
              <div className="message-sender">{msg.user}</div>
              <div className="message-content">{msg.message}</div>
            </div>
          ))}
        </div>
        <div className="chat-input-container">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            className="chat-input"
            disabled={!isConnected}
          />
          <button onClick={sendMessage} className="send-message-btn" disabled={!isConnected}>
            <i className="fas fa-paper-plane"></i>
          </button>
        </div>
      </div>
    </div>
  );
}

function Video({ stream, peerId }) {
  const ref = useRef();
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      setHasVideo(stream.getVideoTracks().length > 0);
      
      // Force play the video
      ref.current.play().catch(err => {
        console.warn("Remote video autoplay prevented:", err);
      });
    }
  }, [stream]);

  return (
    <div className="video-item">
      <video 
        ref={ref} 
        autoPlay 
        playsInline 
        muted={false}
        onLoadedMetadata={() => {
          // Force play in case autoplay is blocked
          if (ref.current) {
            ref.current.play().catch(console.error);
          }
        }}
      />
      <div className="video-overlay">
        <span>User {peerId.substring(0, 8)}</span>
        {!hasVideo && <div className="no-video-indicator">No video</div>}
      </div>
    </div>
  );
}