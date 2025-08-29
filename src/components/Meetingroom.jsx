import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from 'react-toastify';
import io from "socket.io-client";
import './RoomMeeting.css';

const useSocket = (url) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 20000,
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

  const myVideo = useRef();
  const streamRef = useRef(null);
  const canvasRef = useRef();
  const frameInterval = useRef();
  const screenStreamRef = useRef(null);
  const originalVideoTrackRef = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState(1);
  const [mediaError, setMediaError] = useState(false);
  const [joinedRoom, setJoinedRoom] = useState(false);
  const [remoteVideos, setRemoteVideos] = useState({});
  const [username, setUsername] = useState("");

  useEffect(() => {
    // Get username from localStorage or prompt
    const savedUsername = localStorage.getItem('username') || `User${Math.floor(Math.random() * 1000)}`;
    setUsername(savedUsername);
    localStorage.setItem('username', savedUsername);
  }, []);

  useEffect(() => {
    let mounted = true;

    const getMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 320, height: 240 },
          audio: true 
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        myVideo.current.srcObject = stream;
        streamRef.current = stream;
        // Store the original video track
        originalVideoTrackRef.current = stream.getVideoTracks()[0];

        // Force play the video
        myVideo.current.play().catch(err => {
          console.warn("Autoplay prevented:", err);
        });

        setMediaError(false);

        // Start capturing and sending frames
        startFrameCapture();
      } catch (err) {
        console.error("Error accessing media devices:", err);
        toast.error("Could not access camera/microphone. Please check permissions.");
        setMediaError(true);
      }
    };

    getMedia();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (frameInterval.current) {
        clearInterval(frameInterval.current);
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!socket || !streamRef.current) return;

    const handleHost = () => {
      console.log("I am the host");
      setIsHost(true);
    };

    const handleUserJoined = (data) => {
      console.log("🆕 User joined:", data.userId, data.username);
      setParticipants(prev => prev + 1);
      toast.info(`${data.username || 'User'} joined the meeting`);
      
      setRemoteVideos(prev => ({
        ...prev,
        [data.userId]: { username: data.username || 'User' }
      }));
    };

    const handleUserLeft = (userId) => {
      console.log("User left:", userId);
      setParticipants(prev => prev - 1);
      
      setRemoteVideos(prev => {
        const newVideos = { ...prev };
        delete newVideos[userId];
        return newVideos;
      });
      
      toast.info("Participant left the meeting");
    };

    const handleVideoFrame = (data) => {
      setRemoteVideos(prev => {
        if (!prev[data.userId]) {
          return {
            ...prev,
            [data.userId]: { 
              username: data.username || 'User', 
              frame: data.frame 
            }
          };
        }
        
        return {
          ...prev,
          [data.userId]: {
            ...prev[data.userId],
            frame: data.frame
          }
        };
      });
    };

    const handleChatMessage = (data) => {
      setMessages((prev) => [...prev, data]);
    };

    const handleEndCall = () => {
      toast.success("Meeting has ended by host");
      cleanup();
      navigate("/Dashboard");
    };

    const handleParticipantCount = (count) => {
      setParticipants(count);
    };

    // Add event listeners
    socket.on("host", handleHost);
    socket.on("user-joined", handleUserJoined);
    socket.on("user-left", handleUserLeft);
    socket.on("video-frame", handleVideoFrame);
    socket.on("chat-message", handleChatMessage);
    socket.on("end-call", handleEndCall);
    socket.on("participant-count", handleParticipantCount);

    // Join room when socket is connected and we have media
    if (isConnected && !joinedRoom && streamRef.current) {
      socket.emit("join-room", { roomId, username });
      setJoinedRoom(true);
      console.log("Joined room:", roomId);
    }

    return () => {
      // Remove event listeners
      socket.off("host", handleHost);
      socket.off("user-joined", handleUserJoined);
      socket.off("user-left", handleUserLeft);
      socket.off("video-frame", handleVideoFrame);
      socket.off("chat-message", handleChatMessage);
      socket.off("end-call", handleEndCall);
      socket.off("participant-count", handleParticipantCount);
    };
  }, [socket, isConnected, roomId, navigate, joinedRoom, username]);

  const startFrameCapture = () => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 320;
      canvasRef.current.height = 240;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    frameInterval.current = setInterval(() => {
      if (streamRef.current && !isCameraOff && socket && socket.connected) {
        try {
          ctx.drawImage(myVideo.current, 0, 0, canvas.width, canvas.height);
          const frameData = canvas.toDataURL('image/jpeg', 0.4);
          
          socket.emit("video-frame", {
            roomId,
            frame: frameData,
            username
          });
        } catch (err) {
          console.error("Error capturing frame:", err);
        }
      }
    }, 200);
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

  const toggleScreenShare = async () => {
    try {
      if (isScreenSharing) {
        // Switch back to camera
        if (originalVideoTrackRef.current) {
          // Re-enable the original video track
          originalVideoTrackRef.current.enabled = true;
          
          // Update the stream with the original track
          if (streamRef.current) {
            // Remove any screen track
            const screenTracks = streamRef.current.getVideoTracks().filter(
              track => track !== originalVideoTrackRef.current
            );
            screenTracks.forEach(track => {
              streamRef.current.removeTrack(track);
              track.stop();
            });
            
            // Add the original track back if it's not already there
            if (!streamRef.current.getVideoTracks().includes(originalVideoTrackRef.current)) {
              streamRef.current.addTrack(originalVideoTrackRef.current);
            }
          }
        }
        
        setIsScreenSharing(false);
        
        // Stop screen stream
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(track => track.stop());
          screenStreamRef.current = null;
        }
      } else {
        // Start screen share
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: "always" }
        });
        
        screenStreamRef.current = screenStream;
        
        // Store the original track and disable it
        if (streamRef.current) {
          const originalVideoTrack = streamRef.current.getVideoTracks()[0];
          if (originalVideoTrack) {
            originalVideoTrackRef.current = originalVideoTrack;
            originalVideoTrack.enabled = false;
          }
          
          // Add the screen track to the stream
          const screenTrack = screenStream.getVideoTracks()[0];
          streamRef.current.addTrack(screenTrack);
        }
        
        setIsScreenSharing(true);

        // Handle when screen share ends
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };
      }
    } catch (err) {
      console.error("Screen share error:", err);
      toast.error("Failed to share screen");
    }
  };

  const sendMessage = () => {
    if (input.trim() && socket && socket.connected) {
      const messageData = {
        roomId,
        user: username,
        message: input.trim(),
        timestamp: new Date().toISOString()
      };
      
      socket.emit("chat-message", messageData);
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
  };

  const cleanup = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (frameInterval.current) {
      clearInterval(frameInterval.current);
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
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
              <span>{username} {isMuted ? " (Muted)" : ""} {isCameraOff ? " (Camera Off)" : ""}</span>
              {isHost && <span className="host-badge">Host</span>}
            </div>
          </div>
          
          {Object.entries(remoteVideos).map(([userId, videoData]) => (
            <div key={userId} className="video-item">
              {videoData.frame ? (
                <img 
                  src={videoData.frame} 
                  alt={`Video from ${videoData.username}`}
                  className="remote-video-frame"
                />
              ) : (
                <div className="video-placeholder">
                  <i className="fas fa-user"></i>
                  <span>Connecting...</span>
                </div>
              )}
              <div className="video-overlay">
                <span>{videoData.username}</span>
              </div>
            </div>
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
          <button onClick={toggleScreenShare} className={`control-btn ${isScreenSharing ? 'active' : ''}`}>
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
            <div key={i} className={`message ${msg.user === username ? 'my-message' : 'their-message'}`}>
              <div className="message-sender">{msg.user === username ? 'You' : msg.user}</div>
              <div className="message-content">{msg.message}</div>
              <div className="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</div>
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