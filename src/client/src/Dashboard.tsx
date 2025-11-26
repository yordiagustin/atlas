import { useState, useEffect, useRef, useCallback } from 'react'
import { animate } from 'animejs'
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  ThemeProvider,
  createTheme,
  CssBaseline,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Divider,
  CircularProgress,
} from '@mui/material'
import type { Theme } from '@mui/material'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import AllInboxOutlinedIcon from '@mui/icons-material/AllInboxOutlined'
import LanOutlinedIcon from '@mui/icons-material/LanOutlined'
import * as signalR from '@microsoft/signalr'

import Reports from './Reports'
import { apiClient, createDashboardHubConnection } from './server'
import type { ProductionResponse, ShiftKey, ShiftLog } from './server'

type ShiftLabel = 'Mañana' | 'Tarde' | 'Noche'

const SHIFT_LABELS: ShiftLabel[] = ['Mañana', 'Tarde', 'Noche']

const SHIFT_TO_API: Record<ShiftLabel, ShiftKey> = {
  'Mañana': 'manana',
  'Tarde': 'tarde',
  'Noche': 'noche',
}

const SHIFT_KEYWORDS_TO_LABEL: Record<string, ShiftLabel> = {
  morning: 'Mañana',
  manana: 'Mañana',
  afternoon: 'Tarde',
  tarde: 'Tarde',
  night: 'Noche',
  noche: 'Noche',
}

const parseApiShift = (value?: string): ShiftLabel => {
  if (!value) return 'Mañana'
  const normalized = value.toLowerCase()
  return SHIFT_KEYWORDS_TO_LABEL[normalized] ?? (normalized.includes('night')
    ? 'Noche'
    : normalized.includes('after')
    ? 'Tarde'
    : 'Mañana')
}

const SHIFT_KEY_TO_LABEL: Record<string, ShiftLabel> = {
  manana: 'Mañana',
  morning: 'Mañana',
  tarde: 'Tarde',
  afternoon: 'Tarde',
  noche: 'Noche',
  night: 'Noche',
}

const resolveShiftLabel = (key?: string, fallback?: string): ShiftLabel =>
  SHIFT_KEY_TO_LABEL[key ?? ''] ?? parseApiShift(fallback)

function Dashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'reports'>('dashboard')
  const [isRunning, setIsRunning] = useState(false)
  const [activeShift, setActiveShift] = useState<ShiftLabel>('Mañana')
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [activeTime, setActiveTime] = useState(0) // tiempo en segundos
  const [production, setProduction] = useState<ProductionResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [socketReady, setSocketReady] = useState(false)
  const hubRef = useRef<signalR.HubConnection | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<unknown>)>(null)
  const [confirmMessage, setConfirmMessage] = useState('')
  const [logs, setLogs] = useState<ShiftLog[]>([])
  const [isLogsLoading, setIsLogsLoading] = useState(false)
  const [realtimeEnabled, setRealtimeEnabled] = useState(false)
  
  const timerRef = useRef<HTMLDivElement>(null)
  const prevTimeRef = useRef<string>('')

  const tabs: { label: string; value: 'dashboard' | 'reports' }[] = [
    { label: 'Dashboard', value: 'dashboard' },
    { label: 'Reportes', value: 'reports' },
  ]

  // Timer que cuenta cuando está activo
  useEffect(() => {
    let interval: number | null = null
    if (isRunning) {
      interval = window.setInterval(() => {
        setActiveTime((prev) => prev + 1)
      }, 1000)
    } else {
      setActiveTime(0)
    }
    return () => {
      if (interval) window.clearInterval(interval)
    }
  }, [isRunning])

  // Animación del timer - solo los números que cambian
  useEffect(() => {
    if (!timerRef.current) return

    const currentTime = formatTime(activeTime)
    const prevTime = prevTimeRef.current
    
    // Si es la primera vez, solo guardar el tiempo
    if (!prevTime) {
      prevTimeRef.current = currentTime
      return
    }

    // Comparar dígito por dígito y animar solo los que cambiaron
    const timerElement = timerRef.current
    const spans = timerElement.querySelectorAll('span')
    
    currentTime.split('').forEach((char, index) => {
      if (char === ':') return
      
      const prevChar = prevTime[index]
      if (prevChar && prevChar !== char && spans[index]) {
        // Solo animar los dígitos que cambiaron
        animate(spans[index], {
          translateY: [-30, 0],
          opacity: [0, 1],
          scale: [0.8, 1],
          duration: 500,
          easing: 'easeOutQuad',
        })
      }
    })

    prevTimeRef.current = currentTime
  }, [activeTime])


  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const theme = createTheme({
    palette: {
      mode: isDarkMode ? 'dark' : 'light',
      primary: {
        main: '#A395FF',
      },
      error: {
        main: '#f44336',
      },
      warning: {
        main: '#ff9800',
      },
      success: {
        main: '#63C289',
      },
    },
    typography: {
      fontFamily: "'Poppins', sans-serif",
    },
    shape: {
      borderRadius: 16,
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: ({ theme }: { theme: Theme }) => ({
            borderRadius: 16,
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 12px 30px rgba(0, 0, 0, 0.35)'
                : '0 10px 30px rgba(15, 15, 15, 0.08)',
            backgroundColor: theme.palette.background.paper,
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? '0 15px 40px rgba(0, 0, 0, 0.45)'
                  : '0 15px 40px rgba(15, 15, 15, 0.12)',
            },
          }),
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            border: 'none',
            borderWidth: 0,
            borderStyle: 'none',
            '&:last-child': {
              paddingBottom: 16,
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            textTransform: 'uppercase',
            fontWeight: 600,
            padding: '12px 24px',
            boxShadow: 'none',
            '&:hover': {
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              transform: 'translateY(-2px)',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 20,
            fontWeight: 500,
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: {
            borderRadius: 12,
          },
        },
      },
      MuiFormControl: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 12,
            },
          },
        },
      },
    },
  })

  const applySnapshot = useCallback((snapshot: ProductionResponse) => {
    setProduction(snapshot)
    // Only update isRunning if realtime is enabled (we're actively running)
    // This prevents flicker when Stop is pressed and backend hasn't updated yet
    if (realtimeEnabled) {
      setIsRunning(snapshot.isRunning)
      if (snapshot.isRunning && snapshot.shiftKey) {
        setActiveShift(resolveShiftLabel(snapshot.shiftKey, snapshot.shiftName))
      }
    }
    setLastUpdated(snapshot.timestamp)
  }, [realtimeEnabled])

  const fetchLogs = useCallback(
    async (currentDate: string, shiftKey: ShiftKey) => {
      setIsLogsLoading(true)
      try {
        const data = await apiClient.getLogs(currentDate, shiftKey)
        setLogs((prev) => {
          const byId = new Map<string, ShiftLog>()
          for (const log of prev) byId.set(log.id, log)
          for (const log of data) byId.set(log.id, log)
          return Array.from(byId.values())
        })
      } catch (error) {
        console.error('Error getting logs', error)
      } finally {
        setIsLogsLoading(false)
      }
    },
    [],
  )

  const refreshDashboardData = useCallback(async () => {
    setIsRefreshing(true)
    try {
      setApiError(null)
      const [status, currentProduction] = await Promise.all([
        apiClient.getStatus(),
        apiClient.getCurrentProduction(),
      ])
      // Only update isRunning from backend if realtime is enabled
      // This prevents flicker when Stop is pressed
      if (realtimeEnabled) {
        setIsRunning(status.isRunning)
        if (status.isRunning && status.shiftKey) {
          setActiveShift(resolveShiftLabel(status.shiftKey, status.activeShift))
        }
      }
      setLastUpdated(status.timestamp)
      applySnapshot(currentProduction)

      const today = new Date().toISOString().slice(0, 10)
      const shiftKey = SHIFT_TO_API[activeShift]
      void fetchLogs(today, shiftKey)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Error al contactar la API')
    } finally {
      setIsRefreshing(false)
    }
  }, [activeShift, applySnapshot, fetchLogs, realtimeEnabled])

  // Abrir/cerrar conexión SignalR solo mientras el sistema está en marcha
  useEffect(() => {
    if (realtimeEnabled) {
      if (!hubRef.current) {
        const connection = createDashboardHubConnection()
        hubRef.current = connection

        connection.on('snapshot', (snapshot: ProductionResponse) => {
          // Only apply snapshot updates when realtime is enabled
          // This prevents updates after Stop is pressed
          if (realtimeEnabled) {
            applySnapshot(snapshot)
          }
        })

        connection.on('log', (log: ShiftLog) => {
          setLogs((prev) => [...prev, log])
        })

        connection.onreconnected(() => {
          setSocketReady(true)
        })

        connection.onclose(() => {
          setSocketReady(false)
          hubRef.current = null
        })

        connection
          .start()
          .then(() => setSocketReady(true))
          .catch((error) => {
            console.error('SignalR connection error', error)
            setApiError('Error en el canal en tiempo real')
          })
      }
    } else {
      if (hubRef.current) {
        hubRef.current
          .stop()
          .catch(() => {
            // ignore
          })
        hubRef.current = null
        setSocketReady(false)
      }
    }

    return () => {
      if (hubRef.current) {
        hubRef.current
          .stop()
          .catch(() => {
            // ignore
          })
        hubRef.current = null
      }
    }
  }, [realtimeEnabled, applySnapshot])

  const executeAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setIsActionLoading(true)
      try {
        await action()
        await refreshDashboardData()
      } catch (error) {
        setApiError(error instanceof Error ? error.message : 'No se pudo ejecutar la acción')
      } finally {
        setIsActionLoading(false)
      }
    },
    [refreshDashboardData],
  )

  const openConfirmation = (message: string, action: () => Promise<unknown>) => {
    setConfirmMessage(message)
    setPendingAction(() => action)
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    if (!pendingAction) return
    setConfirmOpen(false)
    await executeAction(pendingAction)
    setPendingAction(null)
  }

  const handleCancelConfirm = () => {
    setConfirmOpen(false)
    setPendingAction(null)
  }

  const handleToggle = () => {
    const shiftKey = SHIFT_TO_API[activeShift]
    if (isRunning) {
      openConfirmation(
        '¿Deseas detener la faja y cerrar la sesión actual?',
        async () => {
          // Immediately set state to stopped to prevent flicker
          setIsRunning(false)
          setActiveTime(0)
          setRealtimeEnabled(false)
          const result = await apiClient.sendStopCommand(shiftKey)
          return result
        },
      )
    } else {
      openConfirmation(
        `¿Iniciar la faja para el turno ${activeShift}?`,
        async () => {
          // Immediately set state to running to prevent flicker
          setIsRunning(true)
          setRealtimeEnabled(true)
          const result = await apiClient.sendStartCommand(shiftKey)
          return result
        },
      )
    }
  }

  const handleRestart = () => {
    const shiftKey = SHIFT_TO_API[activeShift]
    openConfirmation(
      'Esta acción reiniciará los contadores de la sesión actual a 0. ¿Continuar?',
      async () => {
        setActiveTime(0)
        return apiClient.sendRestartCommand(shiftKey)
      },
    )
  }

  const handleShiftSelect = (shiftLabel: ShiftLabel) => {
    // Only change local selection; the real shift is defined when Start is pressed.
    if (shiftLabel === activeShift || isActionLoading) return
    if (isRunning) return
    setActiveShift(shiftLabel)
  }

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode)
  }

  const lastUpdateLabel = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Sin datos'
  const actionDisabled = isActionLoading

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {apiError && (
        <Container maxWidth="xl" sx={{ pt: 3 }}>
          <Alert severity="error" onClose={() => setApiError(null)}>
            {apiError}
          </Alert>
        </Container>
      )}
      {/* Navbar */}
      <Box
        sx={{
          width: '100%',
          bgcolor: 'background.paper',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          py: 2.5,
        }}
      >
        <Container maxWidth="xl">
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h5" fontWeight={600} color="text.primary">
                Welcome back
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Panel de Control del Sistema
              </Typography>
            </Box>
            <IconButton 
              onClick={toggleTheme} 
              color="inherit"
              sx={{
                borderRadius: 2,
                bgcolor: 'action.hover',
                '&:hover': {
                  bgcolor: 'action.selected',
                  transform: 'scale(1.05)',
                },
              }}
            >
              {isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Box>
        </Container>
      </Box>

      {/* Tabs */}
      <Box
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.default',
        }}
      >
        <Container maxWidth="xl">
          <Box display="flex" gap={3}>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.value
              return (
                <Box
                  key={tab.value}
                  component="button"
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  sx={(theme) => ({
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: '16px 4px 12px',
                    position: 'relative',
                    color: isActive
                      ? theme.palette.mode === 'dark'
                        ? theme.palette.common.white
                        : theme.palette.text.primary
                      : theme.palette.text.secondary,
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '0.95rem',
                    letterSpacing: 0.3,
                    transition: 'color 0.2s ease',
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      left: 0,
                      bottom: 0,
                      width: '100%',
                      height: 3,
                      borderRadius: 999,
                      backgroundColor: isActive
                        ? theme.palette.mode === 'dark'
                          ? theme.palette.common.white
                          : theme.palette.text.primary
                        : 'transparent',
                      transition: 'background-color 0.2s ease',
                    },
                    '&:hover': {
                      color:
                        theme.palette.mode === 'dark'
                          ? theme.palette.common.white
                          : theme.palette.text.primary,
                    },
                  })}
                >
                  {tab.label}
                </Box>
              )
            })}
          </Box>
        </Container>
      </Box>

      {activeTab === 'dashboard' ? (
        <Container maxWidth="xl" sx={{ py: 3 }}>
        <Box display="flex" gap={3} flexDirection={{ xs: 'column', lg: 'row' }} alignItems="stretch">
          {/* Panel izquierdo */}
          <Box sx={{ flex: { xs: 1, lg: '0 0 60%' }, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Fila superior: Control + Timer */}
            <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
              {/* Card Control */}
              <Card 
                sx={{
                  flex: 1,
                  bgcolor: isRunning ? 'success.main' : 'error.main',
                  color: 'white',
                  boxShadow: '0 15px 35px rgba(15, 15, 15, 0.25)',
                  height: 300,
                  display: 'flex',
                  flexDirection: 'column',
                  '&:hover': {
                    bgcolor: isRunning ? '#58b67d' : '#e53935',
                  },
                }}
              >
                <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  {/* Botones arriba */}
                  <Box
                    sx={{
                      display: 'flex',
                      gap: 1,
                      justifyContent: 'flex-end',
                      mb: 4,
                    }}
                  >
                    <IconButton
                      onClick={handleToggle}
                      disabled={actionDisabled}
                      sx={{
                        width: 48,
                        height: 48,
                        bgcolor: 'rgba(255, 255, 255, 0.25)',
                        color: 'white',
                        border: '1px solid rgba(255, 255, 255, 0.35)',
                        '&:hover': {
                          bgcolor: 'rgba(255, 255, 255, 0.35)',
                          transform: 'scale(1.05)',
                        },
                        transition: 'all 0.3s ease',
                      }}
                    >
                      {isRunning ? <StopIcon /> : <PlayArrowIcon />}
                    </IconButton>
                    <IconButton
                      onClick={handleRestart}
                      disabled={actionDisabled}
                      sx={{
                        width: 48,
                        height: 48,
                        bgcolor: 'rgba(255, 255, 255, 0.25)',
                        color: 'white',
                        border: '1px solid rgba(255, 255, 255, 0.35)',
                        '&:hover': {
                          bgcolor: 'rgba(255, 255, 255, 0.35)',
                          transform: 'scale(1.05)',
                        },
                        transition: 'all 0.3s ease',
                      }}
                    >
                      <RestartAltIcon />
                    </IconButton>
                  </Box>

                  {/* Contenido abajo */}
                  <Box sx={{ mt: 'auto' }}>
                    <Typography variant="h5" fontWeight={700} color="white" mb={0.5}>
                      {isRunning ? 'Activo' : 'Inactivo'}
                    </Typography>
                    <Typography variant="body2" color="rgba(255, 255, 255, 0.8)" mb={2}>
                      Estado del Sistema
                    </Typography>
                    {/* Shift chips */}
                    <Stack direction="row" spacing={1.5} flexWrap="nowrap">
                      {SHIFT_LABELS.map((shiftLabel) => (
                        <Chip
                          key={shiftLabel}
                          label={shiftLabel}
                          onClick={() => handleShiftSelect(shiftLabel)}
                          disabled={isRunning || actionDisabled}
                          sx={{
                            cursor: isRunning ? 'not-allowed' : 'pointer',
                            opacity: activeShift === shiftLabel ? 1 : 0.5,
                            fontWeight: activeShift === shiftLabel ? 700 : 400,
                            fontSize: '0.8rem',
                            letterSpacing: 0.4,
                            height: 30,
                            px: 2,
                            flex: 1,
                            bgcolor: activeShift === shiftLabel 
                              ? 'rgba(255, 255, 255, 0.6)' 
                              : 'rgba(255, 255, 255, 0.15)',
                            color: activeShift === shiftLabel
                              ? 'rgba(20, 20, 20, 0.9)'
                              : 'rgba(255, 255, 255, 0.95)',
                            border: activeShift === shiftLabel
                              ? '2px solid rgba(255, 255, 255, 0.9)'
                              : '1px solid rgba(255, 255, 255, 0.4)',
                            '&:hover': {
                              opacity: isRunning ? (activeShift === shiftLabel ? 1 : 0.5) : 1,
                              bgcolor: activeShift === shiftLabel 
                                ? 'rgba(255, 255, 255, 0.8)' 
                                : 'rgba(255, 255, 255, 0.25)',
                            },
                            transition: 'all 0.3s ease',
                            boxShadow: 'none',
                          }}
                        />
                      ))}
                    </Stack>
                    <Typography variant="caption" color="rgba(255, 255, 255, 0.8)" display="block" mt={2}>
                      Estado actualizado: {isRefreshing ? 'Actualizando…' : lastUpdateLabel}
                      {socketReady ? ' • Tiempo real' : ''}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>

              {/* Card Timer */}
              <Card sx={{ 
                flex: 1,
                height: 300,
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
              }}>
                <CardContent sx={{ width: '100%', textAlign: 'center' }}>
                  <Stack spacing={3} alignItems="center">
                    <Box display="flex" alignItems="center" gap={1} color="text.secondary">
                      <AccessTimeIcon />
                      <Typography variant="subtitle2" fontWeight={600}>
                        Tiempo en marcha
                      </Typography>
                    </Box>
                    <Typography 
                      ref={timerRef}
                      variant="h3" 
                      fontWeight={700} 
                      color="text.primary" 
                      textAlign="center"
                      component="div"
                      sx={{
                        fontFamily: 'monospace',
                        letterSpacing: '0.1em',
                        minHeight: '60px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {formatTime(activeTime).split('').map((char, i) => (
                        <Box
                          key={`${char}-${i}-${activeTime}`}
                          component="span"
                          sx={{
                            display: 'inline-block',
                            minWidth: char === ':' ? '0.3em' : '0.6em',
                          }}
                        >
                          {char}
                        </Box>
                      ))}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Box>

            {/* Conteo de cajas */}
            <Card
              sx={{
                minHeight: 260,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={600} color="text.primary" mb={1}>
                  Conteo de cajas
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Datos por sesión activa del turno seleccionado
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
                    gap: 2.5,
                    mt: 3,
                  }}
                >
                  {[
                    {
                      label: 'Cajas pequeñas',
                      value: production?.smallBoxes ?? 0,
                      size: 28,
                      color: '#FFC58F',
                      total: false,
                    },
                    {
                      label: 'Cajas medianas',
                      value: production?.mediumBoxes ?? 0,
                      size: 36,
                      color: '#A5D8FF',
                      total: false,
                    },
                    {
                      label: 'Cajas grandes',
                      value: production?.largeBoxes ?? 0,
                      size: 44,
                      color: '#B5E48C',
                      total: false,
                    },
                    {
                      label: 'Total',
                      value: production?.total ?? 0,
                      size: 40,
                      color: '#E599F7',
                      total: true,
                    },
                  ].map((metric) => (
                    <Box
                      key={metric.label}
                      sx={{
                        textAlign: 'center',
                        px: 1,
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          mb: 1,
                          minHeight: 56,
                          color: metric.color,
                        }}
                      >
                        {metric.total ? (
                          <AllInboxOutlinedIcon
                            sx={{ fontSize: metric.size, color: metric.color }}
                          />
                        ) : (
                          <Inventory2OutlinedIcon
                            sx={{ fontSize: metric.size, color: metric.color }}
                          />
                        )}
                      </Box>
                      <Typography variant="subtitle2" color="text.secondary" fontWeight={500}>
                        {metric.label}
                      </Typography>
                      <Typography variant="h5" fontWeight={700} mt={0.5}>
                        {metric.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
                {production?.sessionStartedAt && (
                  <Typography variant="body2" color="text.secondary" mt={3}>
                    Sesión iniciada a las{' '}
                    {new Date(production.sessionStartedAt).toLocaleTimeString()}
                    {production.sessionStoppedAt
                      ? ` y cerrada a las ${new Date(production.sessionStoppedAt).toLocaleTimeString()}`
                      : ' (activa)'}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Box>

          {/* Card Logs / Eventos */}
          <Box sx={{ flex: { xs: 1, lg: '0 0 40%' }, display: 'flex' }}>
            <Card
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <CardContent sx={{ flex: 1, p: 3, display: 'flex', flexDirection: 'column' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="h6" fontWeight={600} color="text.primary">
                    Logs
                  </Typography>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.75,
                      px: 1.5,
                      py: 0.5,
                      borderRadius: 999,
                      bgcolor: socketReady ? 'success.main' : 'error.main',
                      color: 'common.white',
                      fontSize: '0.75rem',
                    }}
                  >
                    <LanOutlinedIcon sx={{ fontSize: 18 }} />
                    <span>{socketReady ? 'Tiempo real' : 'Offline'}</span>
                    {(isLogsLoading || isActionLoading) && (
                      <CircularProgress
                        size={14}
                        sx={{ color: 'common.white', ml: 0.5 }}
                      />
                    )}
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Últimos mensajes recibidos para el turno seleccionado
                </Typography>
                <Divider />
                <Box
                  sx={{
                    mt: 2,
                    flex: 1,
                    minHeight: 260,
                    maxHeight: '55vh',
                    overflowY: 'auto',
                    pr: 1,
                  }}
                >
                  {logs.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Aún no hay logs para este turno.
                    </Typography>
                  ) : (
                    logs
                      .slice()
                      .reverse()
                      .map((log) => (
                        <Box
                          key={log.id}
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            py: 0.75,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Box sx={{ minWidth: 160 }}>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </Typography>
                            <Typography variant="body2" fontWeight={500}>
                              {log.eventType?.startsWith('BOX_')
                                ? `Caja detectada: ${
                                    log.eventType.split('_')[1].toLowerCase() === 'small'
                                      ? 'Pequeña'
                                      : log.eventType.split('_')[1].toLowerCase() === 'medium'
                                      ? 'Mediana'
                                      : 'Grande'
                                  }`
                                : log.eventType ?? (log.isRunning ? 'TELEMETRY' : 'IDLE')}
                            </Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            {log.deviceId && (
                              <Typography variant="caption" color="text.secondary">
                                Dispositivo: {log.deviceId}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      ))
                  )}
                </Box>
              </CardContent>
            </Card>
          </Box>
        </Box>
        </Container>
      ) : (
        <Reports />
      )}

      <Dialog open={confirmOpen} onClose={handleCancelConfirm}>
        <DialogTitle>Confirmar acción</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmMessage}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelConfirm} color="inherit">
            Cancelar
          </Button>
          <Button onClick={handleConfirm} color="primary" autoFocus disabled={isActionLoading}>
            Confirmar
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  )
}

export default Dashboard
