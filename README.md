# FinSight

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2.0-blue)](https://reactjs.org/)

A risk-free investment simulation platform integrated with behavioral finance analytics. Practice multi-asset trading, track portfolio performance, understand behavioral biases, and learn through gamified progression and scenarios.

## Features

### Trading Desk (`/trading`)
- **Order Building**: Create baskets of buy/sell orders for multiple assets simultaneously. Supports Market (immediate execution), Limit (price threshold), and Stop (trigger price) orders.
- **Asset Selection**: Search and filter from a catalog of 40+ instruments including stocks (e.g., AAPL, TSLA), crypto (e.g., BTC), commodities (e.g., GOLD), and ETFs.
- **Portfolio Tracking**: Monitor the active user's real simulation cash, positions, and trading fees.
- **Order Execution**: Execute entire baskets in one go, with confirmation dialogs and toast notifications for feedback.
- **Order Management**: View pending orders, modify quantities, and remove items from the basket before execution.

### Portfolio Analytics (`/portfolio`)
- **Holdings Overview**: Display current positions with symbol, quantity, average cost, current price, and unrealized P/L.
- **Asset Allocation**: Pie chart showing breakdown by asset class (Equities, Crypto, Commodities, Cash) with percentages.
- **Risk Profile**: Radar chart visualizing risk metrics derived from live holdings and trade history:
  - Volatility: Price fluctuation measure
  - Concentration: Exposure to single assets
  - Liquidity: Ease of selling positions
  - Drawdown: Maximum peak-to-trough decline
  - Trade load: Recent execution pressure
  - Beta: Market sensitivity
- **Performance Metrics**: Track portfolio value, total return, and Sharpe ratio for risk-adjusted returns.
- **Position Details**: Drill down into individual holdings for detailed P/L analysis.

### Behavioral Analytics (`/behavioral`)
- **Bias Detection**: Automated tracking of behavioral metrics from actual simulated trades and current holdings:
  - Loss Aversion (BM-1): Rises when open positions are below average cost
  - Overtrading (BM-2): Rises with same-day execution frequency
  - Volatility Sensitivity (BM-3): Rises when trades are placed in assets with larger current moves
  - Herding (BM-4): Rises with buy-heavy behavior and high concentration
- **Prospect Theory**: Interactive visualization of the value function v(x) with parameters α=0.88 (risk aversion for gains) and λ=2.25 (loss aversion ratio).
- **Decision Logging**: Record and analyze sequential trading decisions to detect bias signals.
- **Personalized Recommendations**: AI-driven suggestions to mitigate identified biases, such as taking breaks during overtrading streaks.

### Gamification (`/gamification`)
- **XP & Leveling**: Earn experience points through actual simulated trades and open positions.
- **Achievements**: Unlock badges from real session milestones such as first trade, diversification, and saved behavioral analysis.
- **Scenario Challenges**: Progress prompts adapt to the user's current activity.
- **Leaderboard**: Compete with real registered users ranked by saved portfolio analysis.
- **Progress Tracking**: Visual indicators for XP gains, level progression, and unlocked features.

### Overview Dashboard (`/`)
- **Key Performance Indicators (KPIs)**: Display live portfolio value, available cash, Sharpe estimate, and behavioral score.
- **Equity Curve**: Session area chart derived from executed orders and current portfolio value.
- **Asset Allocation**: Visual breakdown derived from current holdings and cash.
- **Market Watch**: Top assets from the simulation universe with current price and percentage change.
- **Quick Actions**: Buttons for "AI Insight" (behavioral tips) and "New Trade" (direct link to trading desk).

### Documentation (`/docs`)
- **IEEE 830 SRS**: Comprehensive software requirements specification covering functional requirements (FR-1 to FR-6), non-functional requirements (NFR), behavioral metrics (BM-x), and AI features (AI-x).
- **System Features**: Detailed breakdown of trading, behavioral analysis, gamification, and analytics modules.
- **Requirements Tracing**: Link requirements to implementation with traceability matrices.
- **External Interfaces**: Specifications for data sources like Yahoo Finance, Alpha Vantage, and Finnhub.

### Settings (`/settings`)
- **Profile Management**: View the authenticated user's name, email, id, and role.
- **Simulation Parameters**: View active cash, fee rate, positions, and executed trade count.
- **Behavioral Feedback**: Toggle bias alerts, cool-down locks for overtrading, and data export options.
- **Data Sources**: Configure and switch between financial data providers.

## Technology Stack

- **Frontend**: React 19.2.0, TanStack React Router/Start/Query, Zustand, Tailwind CSS, Radix UI
- **Backend**: TanStack Start with Cloudflare Workers
- **Build Tool**: Vite 7.3.1
- **Language**: TypeScript 5.8.3
- **Data Visualization**: Recharts
- **Forms**: React Hook Form with Zod validation
- **Icons**: Lucide React

## Local development

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- A Supabase project with its URL and API keys

### Environment variables

Create a local `.env` file in the project root. Never commit this file or expose the service-role key to the browser.

Required for the client and server:

```env
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
SUPABASE_URL=<your-supabase-url>
SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
```

Optional integrations:

```env
GEMINI_API_KEY=<your-gemini-api-key>
ALPHA_VANTAGE_API_KEY=<your-alpha-vantage-api-key>
```

For the local Big Data path, set the following server-side values:

```env
VITE_MARKET_REFRESH_MODE=local
INGESTION_GATEWAY_URL=http://localhost:18080
INGESTION_GATEWAY_TOKEN=local-integration-token
ANALYTICS_USER_SALT=<local-random-salt>
```

With `VITE_MARKET_REFRESH_MODE=local`, the frontend calls the local server
refresh route. That route stores market prices in Supabase and publishes the
same market events to the local ingestion gateway, which forwards them to
Kafka. Keep the gateway token and analytics salt server-only; never prefix
them with `VITE_`.

The default mode remains the deployed Supabase Edge Function. Use that mode
only when the Edge Function has a reachable ingestion gateway.

`VITE_*` variables are available in browser code. Keep `SUPABASE_SERVICE_ROLE_KEY` and other server-only keys without the `VITE_` prefix.

### Install and run

From the project root:

```powershell
npm.cmd install
npm.cmd run dev
```

The local development server is available at `http://localhost:5173`.

If PowerShell reports that `npm.ps1` is blocked by the execution policy, use the `npm.cmd` commands above. Alternatively, for the current Windows user, PowerShell can be configured once with:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Verify the project

```powershell
npm.cmd run lint
npm.cmd run build
```

To preview the production build:

```powershell
npm.cmd run preview
```

## Usage

- **Trading**: Navigate to `/trading` to build and execute orders.
- **Portfolio**: View holdings and risk analytics at `/portfolio`.
- **Behavioral**: Analyze biases and get recommendations at `/behavioral`.
- **Gamification**: Check progress and challenges at `/gamification`.
- **Settings**: Customize simulation parameters at `/settings`.

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
