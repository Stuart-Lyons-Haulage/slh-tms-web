# Mobile smoke checks

Target widths: 390px (iPhone), 430px (large phone), 700px breakpoint.

- Signed-in header: menu, SLH brand, sign-out and global search remain accessible without horizontal overflow.
- System strip sits below the two-row mobile header.
- Side navigation starts below the system strip and remains scrollable.
- Main content does not overflow the viewport.
- Inputs/selects use 16px text on mobile to avoid iOS focus zoom.
- Primary buttons meet a 44px touch target.
- KPI grids collapse cleanly at <=420px.
- Tables remain complete and horizontally scroll inside full-width wrappers.
- Attention rows remove the fixed severity column on mobile.
- Management filters and presets expand to phone width.
- Order Review nested card headers are reset from the global fixed header rule.
