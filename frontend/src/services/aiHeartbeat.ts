// =============================================================================
// AI HEARTBEAT - Servicio de monitoreo de IA
// Verifica disponibilidad de la IA a través del backend (no directo a LM Studio)
// =============================================================================

const API_URL = import.meta.env.PUBLIC_API_URL || 'http://127.0.0.1:8000/api';
const HEARTBEAT_INTERVAL = 30000; // 30 segundos

type AIStatusListener = (connected: boolean) => void;

class AIHeartbeatService {
  private _connected: boolean = false;
  private _checking: boolean = false;
  private _intervalId: number | null = null;
  private _listeners: AIStatusListener[] = [];

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Verifica si la IA está disponible a través del backend
   */
  async checkConnection(): Promise<boolean> {
    if (this._checking) return this._connected;
    this._checking = true;

    try {
      const token = localStorage.getItem('estok_access_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_URL}/objetos/test_ia_stress/`, {
        method: 'GET',
        headers,
      });

      const data = await response.json();
      this._connected = response.ok && data.status === 'ok';
    } catch {
      this._connected = false;
    } finally {
      this._checking = false;
      this._notifyListeners();
    }

    return this._connected;
  }

  /**
   * Inicia el monitoreo periódico
   */
  start(): void {
    this.checkConnection();
    if (this._intervalId === null) {
      this._intervalId = window.setInterval(() => {
        this.checkConnection();
      }, HEARTBEAT_INTERVAL);
    }
  }

  /**
   * Detiene el monitoreo
   */
  stop(): void {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Escucha cambios de estado
   */
  onStatusChange(listener: AIStatusListener): () => void {
    this._listeners.push(listener);
    // Notificar inmediatamente con el estado actual
    listener(this._connected);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  private _notifyListeners(): void {
    this._listeners.forEach(l => l(this._connected));
  }
}

export const aiHeartbeat = new AIHeartbeatService();
export default aiHeartbeat;
