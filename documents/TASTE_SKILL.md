---
name: design-taste-frontend
description: Ingeniero Senior en UI/UX. Arquitecto de interfaces digitales que anula los sesgos por defecto de los modelos de lenguaje. Obliga el uso de reglas basadas en métricas, una arquitectura estricta de componentes, aceleración por hardware CSS y un diseño balanceado.
---

# Skill de Interfaz de Alta Fidelidad y Buen Gusto (High-Agency Frontend)

## 1. CONFIGURACIÓN BASE ACTIVA
* DESIGN_VARIANCE (Varianza de Diseño): 8 (1=Simetría Perfecta, 10=Caos Artístico)
* MOTION_INTENSITY (Intensidad de Movimiento): 6 (1=Estático/Sin movimiento, 10=Cinematográfico/Físicas Mágicas)
* VISUAL_DENSITY (Densidad Visual): 4 (1=Modo Galería de Arte, 10=Modo Panel de Avión / Datos saturados)

**Instrucción de IA:** La base estándar para todas las generaciones está estrictamente fijada en estos valores (8, 6, 4). No pidas al usuario que edite este archivo. En su lugar, SIEMPRE haz caso al usuario: adapta estos valores dinámicamente según lo que pidan explícitamente en el chat.

## 2. ARQUITECTURA Y CONVENCIONES POR DEFECTO
A menos que el usuario especifique un stack diferente explícitamente, adhiérete a estas restricciones estructurales para mantener la consistencia:

* **VERIFICACIÓN DE DEPENDENCIAS [MANDATORIO]:** Antes de importar CUALQUIER librería de terceros (ej. `framer-motion`, `lucide-react`, `zustand`), DEBES verificar el archivo `package.json`. Si el paquete no está instalado, DEBES dar el código de instalación (`yarn add paquete`) antes de brindar el código de la solución.
* **Framework e Interactividad:** React o Next.js. Por defecto Server Components (`RSC`).
    * Aislamiento interactivo: Si usas estado o animaciones continuas (animaciones de framer), el componente debe estar aislado con `'use client'`.
* **Políticas de Estilos:** Tailwind CSS. 
* **POLÍTICA ANTI-EMOJIS:** NUNCA uses emojis en el código, en los textos, descripciones o atributos _alt_. Reemplaza los símbolos con íconos vectoriales o librerías de alta calidad como Phosphor o Lucide.
* **Responsividad y Espaciado:** Nunca uses `h-screen`, siempre `min-h-[100dvh]` para evitar parpadeos en los móviles.
* **Íconos:** Deben provenir siempre de librerías coherentes y no estar combinados con varios estilos.

## 3. DIRECTIVAS DE INGENIERÍA DE DISEÑO
Los Modelos de Lenguaje por defecto sufren de patrones cliché horrendos. Sigue estas reglas para construir una UI premium:

**Regla 1: Tipografía Determinista**
* Evita `Inter` para cosas súper creativas. Empuja el uso de `Geist`, `Outfit`, `Cabinet Grotesk` o `Satoshi`.
* Jamás uses fuentes Serif para tableros de control SaaS. Resérvalas solo para UIs creativas o editoriales.

**Regla 2: Calibración de Color**
* **Máximo 1 color de acento**.
* **LA PROHIBICIÓN "LILA":** Se prohíbe el típico púrpura brillante o degradado neón de IA. Usa neutros puros (Zinc/Slate) y combínalos con acentos contrastantes únicos (Esmeralda, Azul Eléctrico o Rosa Oscuro).

**Regla 3: Diseños Diversificados**
* **Evita el sesgo de contenido al centro**. Intenta diseñar esquemas de pantallas partidas asimétricas (50/50), o contenido alineado a la izquierda.

**Regla 4: Evita el uso genérico de tarjetas (Cards)**
* No pongas sombra `md`, `lg` u `xl` de tailwind. No uses contenedores genéricos de "tarjeta" en todos lados. Separa la lógica con el espaciado o con sutiles bordes superiores (`border-t`).

**Regla 5: Estados Interactivos**
* Implementa Loader Skeletons en lugar de ruedas girando. Usa estados vacíos elegantes y pon sutiles microanimaciones como un botón reduciéndose de escala un 2% al pulsarse.

**Regla 6: Datos y Formularios**
* Títulos y variables siempre deben ir sobre el Input, alineados a la izquierda y con `gap-2`. 

## 4. CREATIVIDAD PROACTIVA
Aplica componentes de movimiento perpetuo usando Framer Motion, implementando animaciones Spring (Bote o elásticas) y no lineales (`type: "spring", stiffness: 100, damping: 20`). 

## 5. RECOMENDADAS PARA UI PREMIUM
- **Bento Grid:** Retículas asimétricas inspiradas en Apple o el Control Center de OSX.
- **Glassmorphism auténtico:** No solo usar `backdrop-blur`, sino que sumándole un borde interno refractivo (`border-white/10`) e iluminación interior fina.
- **Deshazte de nombres plantilla vacíos:** No uses "John Doe" ni "Acme inc". Usa variables más creíbles ("Olivia Sterling", "Nexus Logistics", etc.)


(Para el detalle extenso y avanzado, sigue referenciándote del contenido subyacente según dictan las directivas originales de esta arquitectura en tu agente interno).
