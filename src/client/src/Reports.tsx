import { useState, useEffect } from 'react'
import {
  Container,
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  Chip,
  Stack,
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Divider,
  Grid,
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { type Dayjs } from 'dayjs'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import AllInboxOutlinedIcon from '@mui/icons-material/AllInboxOutlined'
import { apiClient } from './server'
import type { ShiftFullReport, ShiftSessionFullReport } from './server'

const SHIFT_LABELS: Record<string, string> = {
  manana: 'Mañana',
  tarde: 'Tarde',
  noche: 'Noche',
}

function Reports() {
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs())
  const [reports, setReports] = useState<ShiftFullReport[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  useEffect(() => {
    void loadReports()
  }, [selectedDate])

  const loadReports = async () => {
    setLoading(true)
    setError(null)
    try {
      const dateString = selectedDate.format('YYYY-MM-DD')
      const shifts = ['manana', 'tarde', 'noche']
      const reportsPromises = shifts.map((shift) =>
        apiClient.getShiftReport(dateString, shift).catch(() => null)
      )
      const results = await Promise.all(reportsPromises)
      const validReports = results.filter((r): r is ShiftFullReport => r !== null)
      setReports(validReports)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar reportes')
    } finally {
      setLoading(false)
    }
  }

  const toggleSession = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const getDuration = (startedAt: string, stoppedAt: string | null) => {
    const start = new Date(startedAt)
    const end = stoppedAt ? new Date(stoppedAt) : new Date()
    const diffMs = end.getTime() - start.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffSecs = Math.floor((diffMs % 60000) / 1000)
    return `${diffMins}:${String(diffSecs).padStart(2, '0')}`
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'success'
      case 'IN_PROGRESS':
        return 'warning'
      case 'NOT_STARTED':
        return 'default'
      default:
        return 'default'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'Completado'
      case 'IN_PROGRESS':
        return 'En Progreso'
      case 'NOT_STARTED':
        return 'No Iniciado'
      default:
        return status
    }
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Box mb={4}>
          <Typography variant="h4" fontWeight={600} mb={2}>
            Reportes por Turno
          </Typography>
          <Typography variant="body1" color="text.secondary" mb={3}>
            Visualiza reportes detallados de producción por turno y sesión
          </Typography>

          <Box display="flex" gap={2} alignItems="center" mb={3} flexWrap="wrap">
            <DatePicker
              label="Seleccionar Fecha"
              value={selectedDate}
              onChange={(newValue) => {
                if (newValue) {
                  setSelectedDate(newValue)
                }
              }}
              format="DD/MM/YYYY"
              slotProps={{
                textField: {
                  sx: { minWidth: 250 },
                  size: 'medium',
                },
              }}
            />
            <Button variant="contained" onClick={loadReports} disabled={loading} size="large">
              {loading ? <CircularProgress size={20} /> : 'Cargar Reportes'}
            </Button>
          </Box>
        </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && reports.length === 0 ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
          <CircularProgress />
        </Box>
      ) : reports.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No hay reportes disponibles para la fecha seleccionada
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={3}>
          {reports.map((report) => (
            <Card key={report.id} elevation={2}>
              <CardContent sx={{ p: 3 }}>
                {/* Header del Turno */}
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3}>
                  <Box>
                    <Typography variant="h5" fontWeight={600} mb={1}>
                      Turno: {SHIFT_LABELS[report.shiftKey] || report.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Fecha: {report.date} | Horario: {report.startTime} - {report.endTime}
                    </Typography>
                  </Box>
                  <Chip
                    label={getStatusLabel(report.status)}
                    color={getStatusColor(report.status) as 'success' | 'warning' | 'default'}
                    size="small"
                  />
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* Resumen Agregado del Turno */}
                <Box mb={3}>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    Resumen del Turno
                  </Typography>
                  <Grid container spacing={2}>
                    {[
                      { label: 'Cajas Pequeñas', value: report.aggregates.smallBoxes, color: '#FFC58F' },
                      { label: 'Cajas Medianas', value: report.aggregates.mediumBoxes, color: '#A5D8FF' },
                      { label: 'Cajas Grandes', value: report.aggregates.largeBoxes, color: '#B5E48C' },
                      { label: 'Total', value: report.aggregates.total, color: '#E599F7' },
                    ].map((metric) => (
                      <Grid item xs={6} sm={3} key={metric.label}>
                        <Paper
                          sx={{
                            p: 2,
                            textAlign: 'center',
                            bgcolor: 'background.default',
                            border: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Box display="flex" justifyContent="center" mb={1}>
                            {metric.label === 'Total' ? (
                              <AllInboxOutlinedIcon sx={{ fontSize: 32, color: metric.color }} />
                            ) : (
                              <Inventory2OutlinedIcon sx={{ fontSize: 32, color: metric.color }} />
                            )}
                          </Box>
                          <Typography variant="subtitle2" color="text.secondary" fontWeight={500}>
                            {metric.label}
                          </Typography>
                          <Typography variant="h5" fontWeight={700} color={metric.color}>
                            {metric.value}
                          </Typography>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* Sesiones */}
                <Box>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    Sesiones ({report.sessions.length})
                  </Typography>
                  {report.sessions.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No hay sesiones registradas para este turno
                    </Typography>
                  ) : (
                    <Stack spacing={2}>
                      {report.sessions.map((session, index) => (
                        <Accordion
                          key={session.sessionId}
                          expanded={expandedSessions.has(session.sessionId)}
                          onChange={() => toggleSession(session.sessionId)}
                        >
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Box width="100%" display="flex" justifyContent="space-between" alignItems="center" pr={2}>
                              <Box>
                                <Typography variant="subtitle1" fontWeight={600}>
                                  Sesión #{index + 1}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  ID: {session.sessionId.substring(0, 8)}...
                                </Typography>
                              </Box>
                              <Box display="flex" gap={2} alignItems="center">
                                <Box display="flex" alignItems="center" gap={0.5}>
                                  <AccessTimeIcon fontSize="small" color="action" />
                                  <Typography variant="caption" color="text.secondary">
                                    {getDuration(session.startedAt, session.stoppedAt)}
                                  </Typography>
                                </Box>
                                <Chip
                                  label={`Total: ${session.total}`}
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                />
                              </Box>
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Stack spacing={3}>
                              {/* Información de la Sesión */}
                              <Box>
                                <Typography variant="subtitle2" fontWeight={600} mb={1}>
                                  Información de la Sesión
                                </Typography>
                                <Grid container spacing={2}>
                                  <Grid item xs={12} sm={6}>
                                    <Typography variant="caption" color="text.secondary">
                                      Inicio
                                    </Typography>
                                    <Typography variant="body2">{formatDateTime(session.startedAt)}</Typography>
                                  </Grid>
                                  <Grid item xs={12} sm={6}>
                                    <Typography variant="caption" color="text.secondary">
                                      Fin
                                    </Typography>
                                    <Typography variant="body2">
                                      {session.stoppedAt ? formatDateTime(session.stoppedAt) : 'En curso'}
                                    </Typography>
                                  </Grid>
                                </Grid>
                              </Box>

                              {/* Conteo de Cajas */}
                              <Box>
                                <Typography variant="subtitle2" fontWeight={600} mb={1}>
                                  Conteo de Cajas
                                </Typography>
                                <Grid container spacing={2}>
                                  <Grid item xs={4}>
                                    <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                                      <Typography variant="caption" color="text.secondary">
                                        Pequeñas
                                      </Typography>
                                      <Typography variant="h6" color="#FFC58F">
                                        {session.smallBoxes}
                                      </Typography>
                                    </Paper>
                                  </Grid>
                                  <Grid item xs={4}>
                                    <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                                      <Typography variant="caption" color="text.secondary">
                                        Medianas
                                      </Typography>
                                      <Typography variant="h6" color="#A5D8FF">
                                        {session.mediumBoxes}
                                      </Typography>
                                    </Paper>
                                  </Grid>
                                  <Grid item xs={4}>
                                    <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                                      <Typography variant="caption" color="text.secondary">
                                        Grandes
                                      </Typography>
                                      <Typography variant="h6" color="#B5E48C">
                                        {session.largeBoxes}
                                      </Typography>
                                    </Paper>
                                  </Grid>
                                </Grid>
                              </Box>

                              {/* Eventos */}
                              {session.events.length > 0 && (
                                <Box>
                                  <Typography variant="subtitle2" fontWeight={600} mb={1}>
                                    Eventos ({session.events.length})
                                  </Typography>
                                  <TableContainer component={Paper} variant="outlined">
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>Tipo</TableCell>
                                          <TableCell>Fecha y Hora</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {session.events.map((event) => (
                                          <TableRow key={event.id}>
                                            <TableCell>
                                              <Chip
                                                label={event.type}
                                                size="small"
                                                color={
                                                  event.type === 'START'
                                                    ? 'success'
                                                    : event.type === 'STOP'
                                                    ? 'error'
                                                    : 'warning'
                                                }
                                              />
                                            </TableCell>
                                            <TableCell>{formatDateTime(event.timestamp)}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </Box>
                              )}

                              {/* Logs */}
                              {session.logs.length > 0 && (
                                <Box>
                                  <Typography variant="subtitle2" fontWeight={600} mb={1}>
                                    Logs ({session.logs.length})
                                  </Typography>
                                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell>Hora</TableCell>
                                          <TableCell>Tipo de Evento</TableCell>
                                          <TableCell>Dispositivo</TableCell>
                                          <TableCell>Estado</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {session.logs.map((log) => (
                                          <TableRow key={log.id}>
                                            <TableCell>{formatTime(log.timestamp)}</TableCell>
                                            <TableCell>
                                              {log.eventType?.startsWith('BOX_')
                                                ? `Caja ${log.eventType.split('_')[1].toLowerCase()}`
                                                : log.eventType || 'N/A'}
                                            </TableCell>
                                            <TableCell>{log.deviceId || 'N/A'}</TableCell>
                                            <TableCell>
                                              <Chip
                                                label={log.isRunning ? 'Activo' : 'Inactivo'}
                                                size="small"
                                                color={log.isRunning ? 'success' : 'default'}
                                              />
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </Box>
                              )}
                            </Stack>
                          </AccordionDetails>
                        </Accordion>
                      ))}
                    </Stack>
                  )}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
      </Container>
    </LocalizationProvider>
  )
}

export default Reports
