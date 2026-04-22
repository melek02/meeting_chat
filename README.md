# Thread Meeting

Thread Meeting is a full-stack meeting app with:

- a `React + Vite + TypeScript` frontend
- a `Node.js + Express + TypeScript` backend
- `Socket.IO` for realtime updates
- `Prisma + PostgreSQL` for persistence

Users can sign up, create or join a meeting, and see a shared live transcript experience.

## Project structure

```text
thread_meeting/
  backend/    Express API, Socket.IO server, Prisma schema
  frontend/   React app built with Vite
  package.json
```

## Prerequisites

Before you run the project, make sure you have:

- `Node.js` and `npm` installed
- `PostgreSQL` installed and running
- a database created for this project, for example `thread_meeting`

## Installation

From the project root, install dependencies for the workspace:

```bash
npm install
```

## Backend environment setup

This project reads its backend configuration from `backend/.env`.

Create or update `backend/.env` with values like these:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/thread_meeting?schema=public"
JWT_SECRET="change-me"
PORT=4000
CLIENT_URL="http://localhost:5173"
```

What these values do:

- `DATABASE_URL`: PostgreSQL connection string used by Prisma
- `JWT_SECRET`: secret used to sign authentication tokens
- `PORT`: backend server port
- `CLIENT_URL`: frontend URL allowed to connect to the backend

## Database setup

After your database is ready and `backend/.env` is configured, run:

```bash
npm run prisma:generate
npm run prisma:migrate
```

This will:

- generate the Prisma client
- apply the Prisma migrations to your PostgreSQL database

## Running the app

You can run the frontend and backend separately in two terminals.

Start the backend:

```bash
npm run dev:backend
```

Start the frontend:

```bash
npm run dev:frontend
```

Then open:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## Optional workspace commands

Run both apps from the root:

```bash
npm run dev
```

Build both apps:

```bash
npm run build
```

## How to use the app

1. Open the frontend in your browser.
2. Sign up for an account or sign in.
3. Create a new meeting or join an existing meeting using a meeting code.
4. Allow microphone and camera access if your browser asks for it.
5. Open the app in multiple tabs or browsers to simulate multiple participants.

## Available scripts

Root scripts:

- `npm run dev` - starts backend and frontend from the workspace root
- `npm run dev:backend` - starts only the backend
- `npm run dev:frontend` - starts only the frontend
- `npm run build` - builds backend and frontend
- `npm run prisma:generate` - generates Prisma client
- `npm run prisma:migrate` - runs Prisma migrations

## Troubleshooting

If the app does not start correctly, check the following:

- PostgreSQL is running
- the database in `DATABASE_URL` exists
- `backend/.env` has the correct values
- port `4000` is free for the backend
- port `5173` is free for the frontend

If Prisma fails, re-check your database connection string and run:

```bash
npm run prisma:generate
npm run prisma:migrate
```
