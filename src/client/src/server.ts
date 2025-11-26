const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? 'http://localhost:5186').replace(/\/$/, '')

const jsonHeaders = { 'Content-Type': 'application/json' }

type ShiftKey = 'manana' | 'tarde' | 'noche'

export interface ShiftEvent {
  id: string
  type: 'START' | 'STOP' | 'RESTART'
  timestamp: string
}

export interface StatusResponse {
  isRunning: boolean
  activeShift: string
  shiftKey: string
  timestamp: string
}

export interface ProductionResponse {
  shiftKey: string
  shiftName: string
  sessionId?: string
  sessionStartedAt?: string
  sessionStoppedAt?: string
  isRunning: boolean
  timestamp: string
  smallBoxes: number
  mediumBoxes: number
  largeBoxes: number
  total: number
}

export interface ShiftSessionSummary {
  sessionId: string
  startedAt: string
  stoppedAt?: string
  smallBoxes: number
  mediumBoxes: number
  largeBoxes: number
  total: number
  events: ShiftEvent[]
}

export interface ShiftLog {
  id: string
  timestamp: string
  isRunning: boolean
  eventType?: string
  sessionId: string
  deviceId?: string
}

export interface ShiftReport {
  name: string
  shiftKey: string
  smallBoxes: number
  mediumBoxes: number
  largeBoxes: number
  total: number
  sessions: ShiftSessionSummary[]
}

export interface ApiErrorPayload {
  error?: string
  details?: string
}

class ApiError extends Error {
  public readonly status: number
  public readonly payload?: ApiErrorPayload

  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init)
  if (!response.ok) {
    let payload: ApiErrorPayload | undefined
    try {
      payload = (await response.json()) as ApiErrorPayload
    } catch {
      // ignore parse error
    }
    throw new ApiError(payload?.error ?? response.statusText, response.status, payload)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const apiClient = {
  getStatus: () => request<StatusResponse>('/api/status'),
  getCurrentProduction: () => request<ProductionResponse>('/api/production/current'),
  getLogs: (date: string, shift: string) =>
    request<ShiftLog[]>(`/api/logs?date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}`),
  getDailyProduction: (date: string) =>
    request<ShiftReport[]>(`/api/production/daily?date=${encodeURIComponent(date)}`),
  sendStartCommand: (shift: ShiftKey) =>
    request<{ message: string }>('/api/control/start', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ shift }),
    }),
  sendStopCommand: (shift: ShiftKey) =>
    request<{ message: string }>('/api/control/stop', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ shift }),
    }),
  sendShiftChangeCommand: (shift: ShiftKey) =>
    request<{ message: string }>('/api/control/shift-select', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ shift }),
    }),
  sendRestartCommand: (shift: ShiftKey) =>
    request<{ message: string }>('/api/control/restart', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ shift }),
    }),
}

import * as signalR from '@microsoft/signalr'

export const createDashboardHubConnection = () =>
  new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE_URL}/hubs/dashboard`, { withCredentials: false })
    .withAutomaticReconnect()
    .build()

export type { ShiftKey }

