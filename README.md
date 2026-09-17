# Estok - Dashboard e Inventario Inteligente

<p align="center">
  <img src="https://shields.io" alt="Astro">
  <img src="https://shields.io" alt="TypeScript">
  <img src="https://shields.io" alt="Tailwind">
  <img src="https://shields.io" alt="Supabase">
</p>

## 📋 Descripción del Proyecto
**Estok** es una aplicación web moderna, ágil y de alto rendimiento diseñada para la gestión de inventarios, taxonomía unificada de objetos y optimización del almacenamiento en tiempo real. 

El proyecto destaca por su interfaz espacial interactiva, permitiendo a los usuarios mapear jerárquicamente sus espacios físicos y gestionar flujos de reventa de manera visual y organizada.

## ✨ Características Principales
*   **Mapa Estok Jerárquico:** Módulo espacial interactivo que permite dividir el almacenamiento en múltiples niveles independientes (Plantas/Habitaciones -> Muebles/Estantes -> Contenedores/Cajas) con soporte de minimapas dinámicos para ubicación rápida.
*   **Módulo de Mudanza (Drag-and-Drop):** Interfaz dividida que permite la transferencia ágil de objetos y contenedores entre diferentes Estoks mediante arrastrar y soltar, sincronizando instantáneamente los cambios en la base de datos.
*   **Taxonomía Unificada:** Clasificación estricta de objetos a través de un catálogo modular con subcategorías opcionales para máxima flexibilidad.
*   **Diseño Responsivo y Modular:** Interfaz limpia y optimizada construida con componentes reutilizables en Astro y estilizada con Tailwind CSS.

## 🛠️ Tecnologías y Arquitectura
*   **Frontend / Full Stack Framework:** Astro (Modo SSR / Híbrido), TypeScript.
*   **Estilos:** Tailwind CSS.
*   **Backend & Persistencia:** Supabase (PostgreSQL) con políticas de seguridad a nivel de fila (RLS).
*   **Infraestructura y Despliegue:** Contenedores Docker, orquestados mediante **Coolify** en un servidor VPS en **Hetzner** bajo dominio propio (DuckDNS).
*   **Metodología de Desarrollo:** Flujo de desarrollo acelerado mediante Ingeniería de Prompts avanzada y agentes autónomos de IA (Gemini y la API de DeepSeek vía Cline).

## 🚀 Guía de Desarrollo Local

Siga estos pasos para ejecutar el proyecto en su entorno local:

### 1. Clonar el repositorio
```bash
git clone https://github.com
cd Estok_2
```

### 2. Instalar dependencias
Asegúrese de tener Node.js instalado (versión 18 o superior recomendada):
```bash
npm install
```

### 3. Variables de Entorno
Cree un archivo `.env` en la raíz del proyecto para conectar su instancia local o de desarrollo de Supabase:
```env
PUBLIC_SUPABASE_URL=tu_url_de_supabase
PUBLIC_SUPABASE_ANON_KEY=tu_clave_anonima_publica
```

### 4. Iniciar el servidor de desarrollo
```bash
npm run dev
```
El servidor se levantará comúnmente en [http://localhost:4321](http://localhost:4321).

## 🗺️ Roadmap / Estado del Proyecto
Actualmente el proyecto se encuentra en su **fase final de pulido técnico**, optimizando el renderizado de los componentes interactivos del mapa, resolviendo flujos de excepciones en consola y estandarizando la generación modular de códigos QR para etiquetado físico de contenedores.
