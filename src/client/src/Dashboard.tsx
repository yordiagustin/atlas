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

import Reports from './Reports'
import { apiClient, createProductionSocket } from './server'
import type { ProductionResponse, ShiftKey } from './server'

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
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [activeTime, setActiveTime] = useState(0) // tiempo en segundos
  const [production, setProduction] = useState<ProductionResponse | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [socketReady, setSocketReady] = useState(false)
  
  const timerRef = useRef<HTMLDivElement>(null)
  const prevTimeRef = useRef<string>('')

  const tabs: { label: string; value: 'dashboard' | 'reports' }[] = [
    { label: 'Dashboard', value: 'dashboard' },
    { label: 'Reports', value: 'reports' },
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
    setIsRunning(snapshot.isRunning)
    setActiveShift(resolveShiftLabel(snapshot.shiftKey, snapshot.shiftName))
    setLastUpdated(snapshot.timestamp)
  }, [])

  const refreshDashboardData = useCallback(async () => {
    setIsRefreshing(true)
    try {
      setApiError(null)
      const [status, currentProduction] = await Promise.all([
        apiClient.getStatus(),
        apiClient.getCurrentProduction(),
      ])
      setIsRunning(status.isRunning)
      setActiveShift(resolveShiftLabel(status.shiftKey, status.activeShift))
      setLastUpdated(status.timestamp)
      applySnapshot(currentProduction)
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Error al contactar la API')
    } finally {
      setIsRefreshing(false)
    }
  }, [applySnapshot])

  useEffect(() => {
    refreshDashboardData()
    const interval = window.setInterval(refreshDashboardData, 15000)
    return () => window.clearInterval(interval)
  }, [refreshDashboardData])

  useEffect(() => {
    const socket = createProductionSocket()
    socket.onopen = () => setSocketReady(true)
    socket.onclose = () => setSocketReady(false)
    socket.onerror = () => setApiError('Error en el canal en tiempo real')
    socket.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as ProductionResponse
        applySnapshot(snapshot)
      } catch (error) {
        console.error('Invalid snapshot payload', error)
      }
    }

    return () => socket.close()
  }, [applySnapshot])

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

  const handleToggle = () => {
    const shiftKey = SHIFT_TO_API[activeShift]
    void executeAction(() =>
      isRunning ? apiClient.sendStopCommand(shiftKey) : apiClient.sendStartCommand(shiftKey),
    )
  }

  const handleRestart = () => {
    const shiftKey = SHIFT_TO_API[activeShift]
    setActiveTime(0)
    void executeAction(() => apiClient.sendRestartCommand(shiftKey))
  }

  const handleShiftSelect = (turno: ShiftLabel) => {
    if (turno === activeShift || isRunning || isActionLoading) return
    void executeAction(async () => {
      await apiClient.sendShiftChangeCommand(SHIFT_TO_API[turno])
      setActiveShift(turno)
    })
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
                  sx={{
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: '16px 4px 12px',
                    position: 'relative',
                    color: isActive ? 'primary.main' : 'text.secondary',
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
                      backgroundColor: isActive ? 'primary.main' : 'transparent',
                      transition: 'background-color 0.2s ease',
                    },
                    '&:hover': {
                      color: 'primary.main',
                    },
                  }}
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
                    {/* Chips de turno */}
                    <Stack direction="row" spacing={1} flexWrap="nowrap">
                      {SHIFT_LABELS.map((turno) => (
                        <Chip
                          key={turno}
                          label={turno}
                          onClick={() => handleShiftSelect(turno)}
                          disabled={isRunning || actionDisabled}
                          sx={{
                            cursor: isRunning ? 'not-allowed' : 'pointer',
                            opacity: isRunning && activeShift !== turno ? 0.5 : 1,
                            fontWeight: activeShift === turno ? 600 : 400,
                            fontSize: '0.75rem',
                            height: 28,
                            px: 1.5,
                            flex: 1,
                            bgcolor: activeShift === turno 
                              ? 'rgba(255, 255, 255, 0.35)' 
                              : 'rgba(255, 255, 255, 0.2)',
                            color: 'white',
                            border: '1px solid rgba(255, 255, 255, 0.35)',
                            '&:hover': {
                              opacity: isRunning ? (activeShift === turno ? 1 : 0.5) : 1,
                              bgcolor: activeShift === turno 
                                ? 'rgba(255, 255, 255, 0.4)' 
                                : 'rgba(255, 255, 255, 0.25)',
                            },
                            transition: 'all 0.3s ease',
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

          {/* Card Placeholder - 50% para tabla de eventos */}
          <Box sx={{ flex: { xs: 1, lg: '0 0 40%' }, display: 'flex' }}>
            <Card sx={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column',
            }}>
              <CardContent sx={{ flex: 1, p: 3 }}>
                <Typography variant="h6" fontWeight={600} color="text.primary" mb={2}>
                  Eventos
                </Typography>
                <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
                  Tabla de eventos aparecerá aquí
                </Typography>
              </CardContent>
            </Card>
          </Box>
        </Box>
        </Container>
      ) : (
        <Reports />
      )}
    </ThemeProvider>
  )
}

export default Dashboard
