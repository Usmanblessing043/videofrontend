import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

export const useSocket = (url) => {
  const socketRef = useRef(null);

  useEffect(() => {
    // Create socket connection
    socketRef.current = io(url, {
      transports: ['websocket', 'polling'],
      upgrade: true,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Connected to server:', socket.id);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [url]);

  return socketRef.current;
};