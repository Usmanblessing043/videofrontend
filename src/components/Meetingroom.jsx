import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from 'react-toastify';
import io from "socket.io-client";
import './RoomMeeting.css';





import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VideoControls } from "@/components/ui/video-controls";
import { VideoParticipant } from "@/components/ui/video-participant";
import { useSocket } from "@/hooks/useSocket";
import { Clock } from "lucide-react";

const backendUrl = process.env.REACT_APP_VIDEOBACKEND_URL || "http://localhost:3022";


const MeetingRoom = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const socket = useSocket(backendUrl);
  
  const [participants, setParticipants] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [meetingDuration, setMeetingDuration] = useState(0);
  const [pinnedParticipant, setPinnedParticipant] = useState(null);
  
  const localVideoRef = useRef(null);
  const startTimeRef = useRef(Date.now());

  // Meeting duration timer
  useEffect(() => {
    const interval = setInterval(() => {
      setMeetingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket || !roomId) return;

    // Join the room
    socket.emit('join-room', {
      roomId,
      userInfo: {
        name: `User ${Math.floor(Math.random() * 1000)}`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}`
      }
    });

    // Listen for new participants
    socket.on('user-joined', (participant) => {
      setParticipants(prev => [...prev, participant]);
      toast.success(`${participant.name} joined the meeting`);
    });

    // Listen for participants leaving
    socket.on('user-left', (userId) => {
      setParticipants(prev => {
        const leavingUser = prev.find(p => p.id === userId);
        if (leavingUser) {
          toast.info(`${leavingUser.name} left the meeting`);
        }
        return prev.filter(p => p.id !== userId);
      });
    });

    // Listen for mute/unmute events
    socket.on('user-muted', ({ userId, isMuted }) => {
      setParticipants(prev => 
        prev.map(p => p.id === userId ? { ...p, isMuted } : p)
      );
    });

    // Listen for video toggle events
    socket.on('user-video-toggle', ({ userId, isVideoOff }) => {
      setParticipants(prev => 
        prev.map(p => p.id === userId ? { ...p, isVideoOff } : p)
      );
    });

    return () => {
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('user-muted');
      socket.off('user-video-toggle');
    };
  }, [socket, roomId]);

  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    
    if (socket) {
      socket.emit('toggle-mute', { roomId, isMuted: newMutedState });
    }
    
    toast.info(newMutedState ? "Microphone muted" : "Microphone unmuted");
  };

  const handleToggleVideo = () => {
    const newVideoState = !isVideoOff;
    setIsVideoOff(newVideoState);
    
    if (socket) {
      socket.emit('toggle-video', { roomId, isVideoOff: newVideoState });
    }
    
    toast.info(newVideoState ? "Camera turned off" : "Camera turned on");
  };

  const handleScreenShare = () => {
    setIsScreenSharing(!isScreenSharing);
    toast.info(isScreenSharing ? "Screen sharing stopped" : "Screen sharing started");
  };

  const handleEndCall = () => {
    if (socket) {
      socket.emit('leave-room', roomId);
    }
    navigate('/');
    toast.success("Call ended");
  };

  const handlePin = (participantId) => {
    setPinnedParticipant(pinnedParticipant === participantId ? null : participantId);
  };

  // Create local participant
  const localParticipant = {
    id: 'local',
    name: 'You',
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=local`,
    isMuted,
    isVideoOff,
    isHost: true,
    isLocal: true,
    isPinned: pinnedParticipant === 'local'
  };

  const allParticipants = [localParticipant, ...participants.map(p => ({
    ...p,
    isPinned: pinnedParticipant === p.id
  }))];

  const pinnedUser = allParticipants.find(p => p.isPinned);
  const gridParticipants = pinnedUser 
    ? allParticipants.filter(p => !p.isPinned)
    : allParticipants;

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-card/50 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">Room: {roomId}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {formatDuration(meetingDuration)}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{allParticipants.length} participant{allParticipants.length !== 1 ? 's' : ''}</span>
        </div>
      </header>

      {/* Video Grid */}
      <main className="flex-1 p-4 overflow-hidden">
        {pinnedUser ? (
          <div className="grid grid-cols-4 gap-4 h-full">
            <div className="col-span-3">
              <VideoParticipant
                key={pinnedUser.id}
                {...pinnedUser}
                onPin={handlePin}
                className="h-full"
              />
            </div>
            <div className="space-y-4 overflow-y-auto">
              {gridParticipants.map((participant) => (
                <VideoParticipant
                  key={participant.id}
                  {...participant}
                  onPin={handlePin}
                  className="aspect-video"
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 h-full" style={{
            gridTemplateColumns: `repeat(${Math.min(Math.ceil(Math.sqrt(allParticipants.length)), 4)}, 1fr)`,
            gridTemplateRows: `repeat(${Math.ceil(allParticipants.length / Math.min(Math.ceil(Math.sqrt(allParticipants.length)), 4))}, 1fr)`
          }}>
            {allParticipants.map((participant) => (
              <VideoParticipant
                key={participant.id}
                {...participant}
                onPin={handlePin}
              />
            ))}
          </div>
        )}
      </main>

      {/* Controls */}
      <footer className="p-4 bg-card/50 backdrop-blur-sm border-t border-white/10">
        <VideoControls
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          onToggleMute={handleToggleMute}
          onToggleVideo={handleToggleVideo}
          onScreenShare={handleScreenShare}
          onEndCall={handleEndCall}
          onToggleChat={() => toast.info("Chat feature coming soon")}
          onToggleParticipants={() => toast.info("Participants panel coming soon")}
        />
      </footer>
    </div>
  );
};

export default MeetingRoom;