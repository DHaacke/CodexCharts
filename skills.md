# Codex Skills for NodeJS App Development

## Core Skills

### 1. Express.js
- Set up RESTful APIs and web servers
- Middleware usage (body-parser, cookie-parser, etc.)
- Route handling and modular routers
- Error handling and custom middleware

### 2. EJS (Embedded JavaScript Templates)
- Dynamic HTML rendering with EJS
- Passing data from Express to EJS views
- Using EJS partials and layouts

### 3. TypeScript
- Type-safe NodeJS development
- Type definitions for Express, MySQL, ChartJS, etc.
- Using interfaces and types for API responses and database models

### 4. ChartJS
- Integrating ChartJS in EJS templates
- Passing data from Node/Express to ChartJS in the frontend
- Creating bar, line, pie, and custom charts

### 5. MySQL
- Connecting to MySQL using `mysql2` or `mysql` npm packages
- Writing SELECT, INSERT, UPDATE, DELETE queries
- Using async/await with MySQL queries
- Handling query results and errors
- Using connection pools for scalability

### 6. Fetching Data from External APIs
- Using `node-fetch` or `axios` to make HTTP requests
- Handling JSON and other response types
- Error handling and retries

### 7. Parsing JSON
- Safely parsing JSON responses
- Validating and transforming API data

### 8. Using MySQL Result Datasets with ChartJS
- Transforming SQL result sets into ChartJS datasets
- Aggregating and formatting data for visualization
- Passing processed data to EJS views for ChartJS rendering

### 9. OpenAI API Integration
- Using the `openai` npm package or direct HTTP requests
- Authenticating with API key
- Sending prompts and handling completions
- Example API key (replace with your own in production):

---

## Installation & Usage Instructions

### 1. Install Required Packages

```sh
npm install express ejs typescript ts-node @types/node @types/express mysql2 chart.js axios openai dotenv
```

### 2. Project Setup
- Initialize TypeScript: `npx tsc --init`
- Set up Express app and EJS views
- Configure `.env` for sensitive keys (e.g., OpenAI API key)

### 3. Using the Skills
- Use Express for routing and API endpoints
- Render dynamic pages with EJS and ChartJS
- Connect to MySQL, run queries, and process results
- Fetch and parse data from external APIs
- Integrate OpenAI API for AI-powered features

### 4. Example Directory Structure

```
project/
├── dist/
├── src/
│   ├── app.ts
│   ├── routes/
│   ├── views/
│   │   └── charts.ejs
│   ├── db/
│   ├── interfaces/
│   ├── managers/
│   ├── processors/
│   └── utils/
├── public/
│   ├── js/
│   │   └── chart-setup.js
│   ├── css/
│   ├── images/
│   └── mockdata/
├── .env
├── package.json
├── tsconfig.json
└── skills.md
```

### 5. Running the Project

```sh
npx ts-node src/app.ts
```

---

## Security Note
**Never commit your real OpenAI API key to public repositories. Use environment variables and .env files.**

---

## Reference
Keep this `skills.md` in your project root for easy access and onboarding.
