/**
 * useVoiceAgent Hook
 * 
 * Manages WebRTC connection to LiveKit for real-time voice conversation.
 * Handles microphone streaming, transcription display, and audio playback.
 */

import { useState, useRef, useCallback, useEffect } from 'react'

// Auto-detect host for remote access - use env vars if set, otherwise derive from window.location
const getHost = () => typeof window !== 'undefined' ? window.location.hostname : 'localhost'
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || `ws://${getHost()}:7880`
const API_BASE = import.meta.env.VITE_API_URL || `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001'}`

export function useVoiceAgent() {
  // Connection state
  const [status, setStatus] = useState('disconnected') // disconnected, connecting, connected, error
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  
  // Conversation state
  const [messages, setMessages] = useState([])
  const [currentTranscript, setCurrentTranscript] = useState('')
  const [error, setError] = useState(null)
  
  // Audio state
  const [volume, setVolume] = useState(1.0)
  const [isMuted, setIsMuted] = useState(false)
  
  // Refs
  const roomRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const audioElementsRef = useRef([]) // Track all audio elements for cleanup
  const abortControllerRef = useRef(null)

  // Helper to clean up audio elements
  const cleanupAudioElements = useCallback(() => {
    audioElementsRef.current.forEach(el => {
      try {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el)
        }
        // Also pause and release the element
        if (el instanceof HTMLAudioElement) {
          el.pause()
          el.srcObject = null
        }
      } catch {
        // Ignore errors during cleanup
      }
    })
    audioElementsRef.current = []
  }, [])

  // Get LiveKit token from backend
  const getToken = useCallback(async (signal) => {
    try {
      const response = await fetch(`${API_BASE}/api/voice/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: `dashboard-${Date.now()}` }),
        signal,
      })
      if (!response.ok) throw new Error('Failed to get token')
      const data = await response.json()
      return data.token
    } catch (err) {
      // Don't throw on abort
      if (err.name === 'AbortError') return null
      console.error('Token error:', err)
      throw err
    }
  }, [])

  // Connect to LiveKit room
  const connect = useCallback(async () => {
    // Cancel any previous connection attempt
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      setStatus('connecting')
      setError(null)

      // Dynamic import of LiveKit SDK
      const { Room, RoomEvent, Track, createLocalAudioTrack } = await import('livekit-client')

      const token = await getToken(abortController.signal)
      if (!token) return // Aborted
      
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      })

      // Set up event handlers
      room.on(RoomEvent.Connected, () => {
        // Connected to LiveKit room
        setStatus('connected')
      })

      room.on(RoomEvent.Disconnected, () => {
        // Disconnected from LiveKit room
        setStatus('disconnected')
        setIsListening(false)
      })

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          // Attach remote audio (TTS output)
          const audioElement = track.attach()
          audioElement.volume = volume
          document.body.appendChild(audioElement)
          audioElementsRef.current.push(audioElement)
          audioElementRef.current = audioElement // Keep ref for volume control
          setIsSpeaking(true)
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach()
          // Remove from tracked elements
          audioElementsRef.current = audioElementsRef.current.filter(el => {
            // Try to remove from DOM if still there
            try {
              if (el && el.parentNode) {
                el.parentNode.removeChild(el)
              }
            } catch {
              // Ignore
            }
            return false // Remove all from array since we're detaching
          })
          setIsSpeaking(false)
        }
      })

      // Handle data messages (transcription)
      room.on(RoomEvent.DataReceived, (data, participant) => {
        try {
          const message = JSON.parse(new TextDecoder().decode(data))
          if (message.type === 'transcript') {
            if (message.final) {
              setMessages(prev => [...prev, {
                role: message.role || 'user',
                content: message.text,
                timestamp: Date.now()
              }])
              setCurrentTranscript('')
            } else {
              setCurrentTranscript(message.text)
            }
          } else if (message.type === 'assistant_speaking') {
            setIsSpeaking(true)
          } else if (message.type === 'assistant_done') {
            setIsSpeaking(false)
          }
        } catch (err) {
          console.error('Error parsing data message:', err)
        }
      })

      // Check if aborted before connecting
      if (abortController.signal.aborted) return

      // Connect to room
      await room.connect(LIVEKIT_URL, token)
      roomRef.current = room

      // Create and publish local audio track
      const audioTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      await room.localParticipant.publishTrack(audioTrack)
      mediaStreamRef.current = audioTrack.mediaStream

    } catch (err) {
      // Don't set error state if aborted
      if (err.name === 'AbortError') return
      console.error('Connection error:', err)
      setError(err.message)
      setStatus('error')
    }
  }, [getToken, volume])

  // Disconnect from room
  const disconnect = useCallback(async () => {
    // Abort any pending connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    if (roomRef.current) {
      try {
        await roomRef.current.disconnect()
      } catch {
        // Ignore errors during disconnect
      }
      roomRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    // Clean up all audio elements from DOM
    cleanupAudioElements()
    audioElementRef.current = null
    setStatus('disconnected')
    setIsListening(false)
  }, [cleanupAudioElements])

  // Toggle listening (mute/unmute local audio)
  const toggleListening = useCallback(async () => {
    if (!roomRef.current) {
      // Connect first
      await connect()
      setIsListening(true)
      return
    }

    const newState = !isListening
    setIsListening(newState)

    // Mute/unmute local audio track
    const localAudio = roomRef.current.localParticipant.getTrackPublications()
    for (const pub of localAudio.values()) {
      if (pub.track?.kind === 'audio') {
        if (newState) {
          await pub.track.unmute()
        } else {
          await pub.track.mute()
        }
      }
    }
  }, [isListening, connect])

  // Mute/unmute playback
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev
      // Apply to all audio elements
      audioElementsRef.current.forEach(el => {
        if (el instanceof HTMLAudioElement) {
          el.muted = newMuted
        }
      })
      return newMuted
    })
  }, [])

  // Update volume
  const updateVolume = useCallback((newVolume) => {
    setVolume(newVolume)
    // Apply to all audio elements
    audioElementsRef.current.forEach(el => {
      if (el instanceof HTMLAudioElement) {
        el.volume = newVolume
      }
    })
  }, [])

  // Interrupt (stop AI speaking)
  const interrupt = useCallback(() => {
    if (roomRef.current) {
      // Send interrupt signal via data channel
      const encoder = new TextEncoder()
      roomRef.current.localParticipant.publishData(
        encoder.encode(JSON.stringify({ type: 'interrupt' })),
        { reliable: true }
      )
    }
    setIsSpeaking(false)
  }, [])

  // Clear conversation
  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cancel any pending connection
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      disconnect()
    }
  }, [disconnect])

  return {
    // State
    status,
    isListening,
    isSpeaking,
    messages,
    currentTranscript,
    error,
    volume,
    isMuted,
    
    // Actions
    connect,
    disconnect,
    toggleListening,
    toggleMute,
    updateVolume,
    interrupt,
    clearMessages,
  }
}

export default useVoiceAgent
