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
} from '@mui/material'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs, { type Dayjs } from 'dayjs'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import AllInboxOutlinedIcon from '@mui/icons-material/AllInboxOutlined'
import PrintIcon from '@mui/icons-material/Print'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { apiClient } from './server'
import type { ShiftFullReport } from './server'

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

  const generatePDF = (report: ShiftFullReport) => {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 15
    let yPosition = margin

    // Título
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text('Reporte de Turno', pageWidth / 2, yPosition, { align: 'center' })
    yPosition += 10

    // Información del turno
    doc.setFontSize(12)
    doc.setFont('helvetica', 'normal')
    doc.text(`Turno: ${SHIFT_LABELS[report.shiftKey] || report.name}`, margin, yPosition)
    yPosition += 7
    doc.text(`Fecha: ${report.date}`, margin, yPosition)
    yPosition += 7
    doc.text(`Horario: ${report.startTime} - ${report.endTime}`, margin, yPosition)
    yPosition += 7
    doc.text(`Estado: ${getStatusLabel(report.status)}`, margin, yPosition)
    yPosition += 10

    // Resumen agregado
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('Resumen del Turno', margin, yPosition)
    yPosition += 8

    autoTable(doc, {
      startY: yPosition,
      head: [['Tipo', 'Cantidad']],
      body: [
        ['Cajas Pequeñas', report.aggregates.smallBoxes.toString()],
        ['Cajas Medianas', report.aggregates.mediumBoxes.toString()],
        ['Cajas Grandes', report.aggregates.largeBoxes.toString()],
        ['Total', report.aggregates.total.toString()],
      ],
      theme: 'striped',
      headStyles: { fillColor: [163, 149, 255], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 10 },
      margin: { left: margin, right: margin },
    })

    yPosition = (doc as any).lastAutoTable.finalY + 10

    // Sesiones
    report.sessions.forEach((session, index) => {
      // Verificar si necesitamos una nueva página
      if (yPosition > doc.internal.pageSize.getHeight() - 60) {
        doc.addPage()
        yPosition = margin
      }

      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text(`Sesión ${index + 1}`, margin, yPosition)
      yPosition += 7

      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.text(`ID: ${session.sessionId.substring(0, 16)}...`, margin, yPosition)
      yPosition += 6
      doc.text(`Inicio: ${formatDateTime(session.startedAt)}`, margin, yPosition)
      yPosition += 6
      doc.text(
        `Fin: ${session.stoppedAt ? formatDateTime(session.stoppedAt) : 'En curso'}`,
        margin,
        yPosition,
      )
      yPosition += 6
      doc.text(`Duración: ${getDuration(session.startedAt, session.stoppedAt)}`, margin, yPosition)
      yPosition += 6

      // Conteo de cajas de la sesión
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Conteo de Cajas:', margin, yPosition)
      yPosition += 7

      autoTable(doc, {
        startY: yPosition,
        head: [['Tipo', 'Cantidad']],
        body: [
          ['Pequeñas', session.smallBoxes.toString()],
          ['Medianas', session.mediumBoxes.toString()],
          ['Grandes', session.largeBoxes.toString()],
          ['Total', session.total.toString()],
        ],
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 9 },
        margin: { left: margin, right: margin },
      })

      yPosition = (doc as any).lastAutoTable.finalY + 8

      // Eventos
      if (session.events.length > 0) {
        if (yPosition > doc.internal.pageSize.getHeight() - 60) {
          doc.addPage()
          yPosition = margin
        }

        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text(`Eventos (${session.events.length})`, margin, yPosition)
        yPosition += 7

        autoTable(doc, {
          startY: yPosition,
          head: [['Tipo', 'Fecha y Hora']],
          body: session.events.map((event) => [
            event.type,
            formatDateTime(event.timestamp),
          ]),
          theme: 'striped',
          headStyles: { fillColor: [100, 100, 100], textColor: 255, fontStyle: 'bold' },
          styles: { fontSize: 8 },
          margin: { left: margin, right: margin },
        })

        yPosition = (doc as any).lastAutoTable.finalY + 8
      }

      // Logs
      if (session.logs.length > 0) {
        if (yPosition > doc.internal.pageSize.getHeight() - 60) {
          doc.addPage()
          yPosition = margin
        }

        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text(`Logs (${session.logs.length})`, margin, yPosition)
        yPosition += 7

        autoTable(doc, {
          startY: yPosition,
          head: [['Hora', 'Tipo de Evento', 'Dispositivo', 'Estado']],
          body: session.logs.map((log) => [
            formatTime(log.timestamp),
            log.eventType?.startsWith('BOX_')
              ? `Caja ${log.eventType.split('_')[1].toLowerCase()}`
              : log.eventType || 'N/A',
            log.deviceId || 'N/A',
            log.isRunning ? 'Activo' : 'Inactivo',
          ]),
          theme: 'striped',
          headStyles: { fillColor: [100, 100, 100], textColor: 255, fontStyle: 'bold' },
          styles: { fontSize: 7 },
          margin: { left: margin, right: margin },
          columnStyles: {
            0: { cellWidth: 30 },
            1: { cellWidth: 50 },
            2: { cellWidth: 40 },
            3: { cellWidth: 30 },
          },
        })

        yPosition = (doc as any).lastAutoTable.finalY + 10
      }

      // Separador entre sesiones
      if (index < report.sessions.length - 1) {
        if (yPosition > doc.internal.pageSize.getHeight() - 30) {
          doc.addPage()
          yPosition = margin
        } else {
          yPosition += 5
        }
      }
    })

    // Pie de página
    const totalPages = doc.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'italic')
      doc.text(
        `Página ${i} de ${totalPages}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' },
      )
      doc.text(
        `Generado el ${dayjs().format('DD/MM/YYYY HH:mm:ss')}`,
        pageWidth - margin,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'right' },
      )
    }

    // Descargar el PDF
    const fileName = `Reporte_${SHIFT_LABELS[report.shiftKey] || report.shiftKey}_${report.date}.pdf`
    doc.save(fileName)
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
                  <Box display="flex" gap={1} alignItems="center">
                    <Button
                      variant="outlined"
                      startIcon={<PrintIcon />}
                      onClick={() => generatePDF(report)}
                      size="small"
                    >
                      Imprimir PDF
                    </Button>
                    <Chip
                      label={getStatusLabel(report.status)}
                      color={getStatusColor(report.status) as 'success' | 'warning' | 'default'}
                      size="small"
                    />
                  </Box>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* Resumen Agregado del Turno */}
                <Box mb={3}>
                  <Typography variant="h6" fontWeight={600} mb={2}>
                    Resumen del Turno
                  </Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 2 }}>
                    {[
                      { label: 'Cajas Pequeñas', value: report.aggregates.smallBoxes, color: '#FFC58F' },
                      { label: 'Cajas Medianas', value: report.aggregates.mediumBoxes, color: '#A5D8FF' },
                      { label: 'Cajas Grandes', value: report.aggregates.largeBoxes, color: '#B5E48C' },
                      { label: 'Total', value: report.aggregates.total, color: '#E599F7' },
                    ].map((metric) => (
                      <Box key={metric.label}>
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
                      </Box>
                    ))}
                  </Box>
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
                                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
                                  <Box>
                                    <Typography variant="caption" color="text.secondary">
                                      Inicio
                                    </Typography>
                                    <Typography variant="body2">{formatDateTime(session.startedAt)}</Typography>
                                  </Box>
                                  <Box>
                                    <Typography variant="caption" color="text.secondary">
                                      Fin
                                    </Typography>
                                    <Typography variant="body2">
                                      {session.stoppedAt ? formatDateTime(session.stoppedAt) : 'En curso'}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Box>

                              {/* Conteo de Cajas */}
                              <Box>
                                <Typography variant="subtitle2" fontWeight={600} mb={1}>
                                  Conteo de Cajas
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
                                  <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                                    <Typography variant="caption" color="text.secondary">
                                      Pequeñas
                                    </Typography>
                                    <Typography variant="h6" color="#FFC58F">
                                      {session.smallBoxes}
                                    </Typography>
                                  </Paper>
                                  <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                                    <Typography variant="caption" color="text.secondary">
                                      Medianas
                                    </Typography>
                                    <Typography variant="h6" color="#A5D8FF">
                                      {session.mediumBoxes}
                                    </Typography>
                                  </Paper>
                                  <Paper sx={{ p: 1.5, textAlign: 'center', bgcolor: 'background.default' }}>
                                    <Typography variant="caption" color="text.secondary">
                                      Grandes
                                    </Typography>
                                    <Typography variant="h6" color="#B5E48C">
                                      {session.largeBoxes}
                                    </Typography>
                                  </Paper>
                                </Box>
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
