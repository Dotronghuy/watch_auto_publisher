---
name: Cybernetic Logic
colors:
  surface: '#121414'
  surface-dim: '#121414'
  surface-bright: '#383939'
  surface-container-lowest: '#0d0e0f'
  surface-container-low: '#1a1c1c'
  surface-container: '#1e2020'
  surface-container-high: '#292a2a'
  surface-container-highest: '#343535'
  on-surface: '#e3e2e2'
  on-surface-variant: '#e1bec5'
  inverse-surface: '#e3e2e2'
  inverse-on-surface: '#2f3131'
  outline: '#a8898f'
  outline-variant: '#594046'
  surface-tint: '#ffb1c4'
  primary: '#ffb1c4'
  on-primary: '#65002e'
  primary-container: '#ff4d8d'
  on-primary-container: '#5b0028'
  inverse-primary: '#b90a5a'
  secondary: '#b0c6ff'
  on-secondary: '#002d6e'
  secondary-container: '#0068ed'
  on-secondary-container: '#f2f3ff'
  tertiary: '#57e15b'
  on-tertiary: '#003908'
  tertiary-container: '#00a92a'
  on-tertiary-container: '#003306'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffd9e0'
  primary-fixed-dim: '#ffb1c4'
  on-primary-fixed: '#3f001a'
  on-primary-fixed-variant: '#8f0043'
  secondary-fixed: '#d9e2ff'
  secondary-fixed-dim: '#b0c6ff'
  on-secondary-fixed: '#001945'
  on-secondary-fixed-variant: '#00429b'
  tertiary-fixed: '#75ff75'
  tertiary-fixed-dim: '#57e15b'
  on-tertiary-fixed: '#002203'
  on-tertiary-fixed-variant: '#00530f'
  background: '#121414'
  on-background: '#e3e2e2'
  surface-variant: '#343535'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
  mono-code:
    fontFamily: jetbrainsMono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  node-gap: 24px
---

## Brand & Style

This design system is built for power users in the social media automation space. It balances the complexity of logic-based workflows with a highly refined, professional aesthetic. The brand personality is technical, reliable, and forward-thinking, evoking the feeling of a sophisticated command center.

The visual style is **Corporate Modern** with a **Glassmorphic** edge. It utilizes a deep, monochromatic base to allow vibrant functional colors to act as data signifiers. The interface prioritizes clarity through high-contrast typography and precise, thin-ruled borders, creating a modular environment where automation feels tangible and controllable.

## Colors

The palette is anchored in a high-density "Obsidian" dark mode. The primary pink-red is reserved for high-priority actions and brand-specific touchpoints. Functional colors are used with high saturation to ensure state changes are immediately visible against the dark backgrounds.

- **Background & Surface:** Depth is created by layering `#1C1C1E` (Surface) over `#0F0F10` (Canvas).
- **Functional Accents:** Neon Green (`#00E676`) represents active nodes and successful execution. Blue (`#2979FF`) is used for informational data and connector paths. Amber (`#FFC107`) signals pending states or configuration requirements.
- **Glassmorphism:** Overlays use a semi-transparent version of the surface color with a 20px backdrop blur to maintain context without visual clutter.

## Typography

The typography system relies on **Inter** for its exceptional legibility in dense data environments. For technical snippets and node IDs, **JetBrains Mono** is utilized to reinforce the "automation" aesthetic.

- **Headlines:** Use tight letter spacing and bold weights to establish a strong hierarchy.
- **Labels:** Small-caps or heavy tracking on labels ensures they remain readable even when used as tiny tags on workflow nodes.
- **Micro-copy:** Use `label-sm` for status indicators and metadata to maximize canvas space.

## Layout & Spacing

The design system employs a **Fluid Grid** for dashboard views and a **Modular Canvas** for the workflow editor. 

- **Workflow Editor:** Uses a 20px dot-grid background for node alignment. Elements snap to a 4px base unit.
- **Dashboards:** A 12-column grid system with 16px gutters.
- **Breakpoints:**
  - **Mobile (<768px):** Single column, margins reduced to 16px. Workflow editor enters "View Only" or simplified list mode.
  - **Desktop (>1024px):** Full multi-pane layout with collapsible sidebars for tools and properties.

## Elevation & Depth

Depth is established through **Tonal Layering** and **Refined Outlines** rather than heavy shadows.

1.  **Level 0 (Canvas):** The base `#0F0F10` background.
2.  **Level 1 (Nodes/Cards):** `#1C1C1E` with a 1px border of `white` at 10% opacity.
3.  **Level 2 (Modals/Popovers):** Glassmorphic surfaces (Surface color at 80% opacity) with a 20px backdrop blur and a more prominent white border at 15% opacity.
4.  **Interaction:** Hovered elements receive a subtle outer glow using the primary or functional status color (e.g., a neon green glow for an active node).

## Shapes

The design uses a **Soft** shape language to maintain a professional, architectural feel. 

- **Standard Elements:** 4px (`0.25rem`) corner radius for nodes and input fields.
- **Containers:** Large cards and workflow containers use 8px (`0.5rem`) radius.
- **Interaction Elements:** Toggle switches and status pills use a full "Pill" radius for immediate recognition as interactive or state-driven components.

## Components

### Buttons
- **Primary:** Solid `#FF4D8D` with white text. No gradient.
- **Ghost:** Transparent background with a 1px border of `white` at 20% opacity.
- **Action Icons:** 32x32px hit area, using thin-stroke icons (1.5px weight).

### Nodes (Workflow Elements)
- **Header:** Contains an icon, title, and a status toggle. 
- **Body:** Darker inset background for configuration fields.
- **Ports:** Small circular connection points (8px) that glow with the functional color when a connection is valid.

### Input Fields
- Understated design: `#0F0F10` background, 1px border. Focus state changes border color to Primary Pink with a 2px outer glow.

### Chips & Tags
- Used for social platform icons (e.g., Instagram, X, LinkedIn). High-contrast icons on a subtle `#1C1C1E` background.

### Scrollbars
- Custom-styled: 4px width, `#333335` track, `#4D4D50` thumb with 10px radius to minimize visual weight on the canvas.