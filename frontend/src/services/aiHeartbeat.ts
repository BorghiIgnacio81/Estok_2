// =============================================================================
// AI HEARTBEAT - Servicio de monitoreo de LM Studio
// Hace ping al endpoint de LM Studio para verificar disponibilidad
// =============================================================================

const LM_STUDIO_URL = 'http://localhost:1234/v1';
const HEARTBEAT_INTERVAL = 15000; // 15 segundos

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
   * Verifica si LM Studio está disponible
   */
  async checkConnection(): Promise<boolean> {
    if (this._checking) return this._connected;
    this._checking = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${LM_STUDIO_URL}/models`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      this._connected = response.ok;
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
