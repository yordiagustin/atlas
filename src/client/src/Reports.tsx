import { Container, Box, Typography, Paper } from '@mui/material'

function Reports() {
  return (
    <Container maxWidth="xl" sx={{ py: 6 }}>
      <Paper
        elevation={0}
        sx={{
          p: 4,
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          textAlign: 'center',
        }}
      >
        <Box mb={2}>
          <Typography variant="h5" fontWeight={600}>
            Reports
          </Typography>
        </Box>
        <Typography variant="body1" color="text.secondary">
          Aquí podrás visualizar reportes y estadísticas del sistema. Próximamente agregaremos más
          información.
        </Typography>
      </Paper>
    </Container>
  )
}

export default Reports

