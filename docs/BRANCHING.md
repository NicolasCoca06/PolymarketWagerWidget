# Branching Strategy

This repository follows a lightweight GitFlow-inspired model:

- `main`: stable, presentation-ready code.
- `develop`: integration branch for reviewed work before release.
- `feature/*`: focused implementation branches.

For this technical test, the widget work lives on:

```text
feature/polymarket-wager-widget
```

Recommended flow:

```text
feature/* -> develop -> main
```

The goal is to make change boundaries explicit without adding ceremony that does not help the project.
