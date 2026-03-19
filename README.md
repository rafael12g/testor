# 🧭 Suivi de Course d'Orientation

Application web temps réel pour le suivi de courses d'orientation. Permet aux **organisateurs** de superviser les courses, aux **participants** (runners) de rejoindre via code d'équipe et consulter la carte en direct, et aux **administrateurs** de superviser l'ensemble du système.

**Architecture** : Frontend React + Backend Node.js/Express + API PostgreSQL externe.

---

## 📋 Table des matières

- [Fonctionnalités](#-fonctionnalités)
- [Architecture](#-architecture)
- [Prérequis](#-prérequis)
- [Installation & Configuration](#-installation--configuration)
- [Lancement](#-lancement)
- [Déploiement](#-déploiement)
- [API REST](#-api-rest)
- [WebSocket](#-websocket)
- [Structure](#-structure-du-projet)
- [Stack](#-stack-technique)

---

## ✨ Fonctionnalités

### 🏃 Runner (Participant)
- Rejoindre une course avec un **code d'équipe**
- Carte Leaflet interactive avec balises en temps réel
- Suivi de progression (checkpoints validés/restants)
- Notification de passage aux balises (via GPS/beacon)

### 🧭 Organisateur
- Créer et superviser des courses via l'**API externe**
- Démarrer/pause/reprendre/arrêter chronométrage
- Gérer les équipes : pause/arrêt individuel
- Enregistrer les passages aux balises

### 👮 Administrateur
- **Console admin** : logs serveur en direct (polling 3s)
- Historique global des événements de course
- Authentification via l'**API externe** avec permissions granulaires
- Vue synthétique : courses, équipes, balises, pings

### ⚡ Temps Réel
- **WebSocket natif** pour diffusion instantanée (pings, events, logs)
- Auto-refresh de l'état API externe (toutes les 30s)
- Détection auto **online/offline** du client
- Broadcast aux tous les clients connectés

---

## 🏗 Architecture

```
┌─────────────────────────┐
│   Frontend (React/Vite) │
│    :5173 / :5174        │
└────────┬────────────────┘
         │ HTTP/WS (proxy)
         ↓
┌─────────────────────────┐
│  Backend (Express/Node) │
│       :8787             │
│  - API REST             │
│  - WebSocket            │
│  - Stockage mémoire     │
└────────┬────────────────┘
         │ HTTP (ApiKey)
         ↓
┌─────────────────────────┐
│  API Externe (PostgreSQL)
│  172.40.1.151:3000      │
│  - Courses              │
│  - Équipes              │
│  - Balises              │
│  - Codes                │
│  - Auth (admin/orga)    │
└─────────────────────────┘
```

**Composants :**
- **Frontend** : SPA React, servie par Vite (dev) ou Express (prod)
- **Backend** : Serveur Express avec WebSocket, stockage volatil (RAM)
- **API externe** : Base PostgreSQL distante, authentifiée par clé API

---

## 📦 Prérequis

- **Node.js** ≥ 20, **npm** ≥ 9
- Accès réseau à l'API externe (`http://172.40.1.151:3000`)
- *(Optionnel)* Docker + Docker Compose pour déploiement

---

## 🚀 Installation & Configuration

### 1. Cloner & installer

```bash
git clone <url>
cd testor
npm install
```

### 2. Configurer `.env`

```bash
cp .env.example .env
```

**Fichier `.env` :**
```env
PORT=8787
API_URL=http://172.40.1.151:3000
API_KEY=<votre_clé_api>
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
```

| Variable       | Description                          | Requis | Défaut |
|----------------|--------------------------------------|--------|--------|
| `PORT`         | Port backend                         | Non    | 8787   |
| `API_URL`      | URL API externe                      | **Oui**| —      |
| `API_KEY`      | Clé API pour l'authentification       | **Oui**| —      |
| `CORS_ORIGINS` | Origines CORS autorisées (`,`-séparées) | Non | *(toutes)* |

---

## ▶️ Lancement

### Mode développement (recommandé)

```bash
npm run dev
```

Lance **simultanément** :
- Backend : `http://localhost:8787/api/...` + `ws://localhost:8787/ws`
- Frontend : `http://localhost:5173` (ou `5174` si port occupé)

Le frontend proxie automatiquement les requêtes `/api/*` vers le backend.

### Backend seul

```bash
npm run api
```

Backend sur `http://localhost:8787`.

### Frontend seul

```bash
npm run dev:front
```

Vite sur `http://localhost:5173` (requiert que le backend soit lancé séparément).

### Scripts disponibles

| Commande      | Description                    |
|---------------|--------------------------------|
| `npm run dev` | API + Vite (dev complet)       |
| `npm run api` | Backend Express seul           |
| `npm run dev:front` | Frontend Vite seul       |
| `npm run build` | Build production frontend      |
| `npm run preview` | Aperçu du build prod           |
| `npm run lint` | ESLint sur tout le projet      |

---

## 🐳 Déploiement

### Docker Compose

```bash
# Lancer (build + run)
npm run docker:up

# Logs
npm run docker:logs

# Arrêter
npm run docker:down

# Reset complet (volumes supprimés)
npm run docker:reset
```

**Configuration :** utilise `.env.docker` au lieu de `.env`.

**Port public :** 80

---

## 📡 API REST

Prefix : `/api`

### Auth

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/auth/admin` | Login admin (via API externe) |
| `POST` | `/api/auth/login` | Login organisateur (via API externe) |
| `POST` | `/api/auth/register` | Inscription organisateur (via API externe) |
| `GET` | `/api/auth/register-info` | Info rate-limit inscription |

**Tous les logins/registrations passent par l'API externe.** Aucun stockage local d'orga.

### Santé

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/health` | État backend + connexion API externe |

### Courses

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/courses` | Liste des courses (API externe) |
| `GET` | `/api/teams/code/:code` | Rejoindre par code équipe |

### Balises & pings

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/beacons/ping` | Enregistrer position équipe |
| `GET` | `/api/beacons/events?limit=20` | Pings récents |
| `GET` | `/api/races/:raceId/beacons` | Snapshot par course |

**Ping body :**
```json
{
  "raceId": "1",
  "teamCode": "ALPHA1",
  "teamName": "Les Explorateurs",
  "lat": 48.8566, "lng": 2.3522,
  "accuracy": 5, "speedKmh": 8.2,
  "heading": 180, "battery": 85
}
```

### Chronométrage (organisateurs)

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/orga/courses/:raceId/start` | Démarrer course |
| `POST` | `/api/orga/courses/:raceId/pause` | Pause course |
| `POST` | `/api/orga/courses/:raceId/resume` | Reprendre |
| `POST` | `/api/orga/courses/:raceId/stop` | Arrêter course |
| `GET` | `/api/orga/courses/:raceId/chrono` | État chrono |
| `POST` | `/api/orga/courses/:raceId/teams/:code/pause` | Pause équipe |
| `POST` | `/api/orga/courses/:raceId/teams/:code/resume` | Reprendre équipe |
| `POST` | `/api/orga/courses/:raceId/teams/:code/stop` | Arrêter équipe |
| `POST` | `/api/orga/courses/:raceId/teams/:code/checkpoint` | Valider passage |
| `GET` | `/api/orga/chronos` | Tous les chronos |

### Événements & historique

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/races/:raceId/events` | Créer événement |
| `GET` | `/api/races/:raceId/history?limit=50` | Historique course |
| `GET` | `/api/history?limit=50` | Historique global |

### Logs (admin)

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/logs?limit=80` | Logs serveur récents |

### Gestion comptes orga (admin)

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/admin/organisateurs` | Liste organisateurs |
| `DELETE` | `/api/admin/organisateurs/:id` | Supprimer orga |
| `PATCH` | `/api/admin/organisateurs/:id/password` | Changer MdP orga |

**Note :** Tous les comptes orga sont gérés par l'API externe. Aucun stockage local.

### Rate limiting

- API générale : **120 req/min**
- Auth : **10 tentatives / 15 min**

---

## 🔌 WebSocket

**Endpoint :** `ws://localhost:8787/ws`

### Messages serveur → client

| Type | Description | Payload |
|------|-------------|---------|
| `connected` | Connexion établie | `{ok: true}` |
| `beacon_ping` | Nouveau ping équipe | Objet ping complet |
| `race_started`, `race_paused`, etc. | Événement course | `{raceId, timestamp}` |
| `log` | Nouveau log serveur | Objet log |
| `checkpoint_reached` | Passage à une balise | `{raceId, teamCode, checkpointIndex}` |

Tous les messages incluent `timestamp`.

---

## 📁 Structure du Projet

```
testor/
├── .env, .env.example, .env.docker
├── package.json, package-lock.json
├── vite.config.js              # Proxy Vite → backend
├── eslint.config.js
├── docker-compose.yml, Dockerfile
│
├── server/
│   ├── index.js                # Serveur Express + WebSocket
│   │                             # Routes API REST
│   │                             # Proxy frontend (prod)
│   └── db.js                   # Logique métier
│                               # Stockage mémoire (pings, logs, events)
│                               # Appels API externe
│
├── src/
│   ├── main.jsx                # Bootstrap React
│   ├── App.jsx                 # Routing & état global
│   ├── App.css, index.css       # Styles
│   ├── api.js                  # Fetch vers backend
│   │
│   ├── components/
│   │   ├── LoginPage.jsx       # Page auth
│   │   ├── AdminPanel.jsx      # Console admin
│   │   ├── OrgaPanel.jsx       # Espace organisateur
│   │   ├── RunnerPanel.jsx     # Vue participant
│   │   ├── VueBeaconMap.jsx    # Carte temps réel
│   │   └── ui/                 # Composants réutilisables
│   │       ├── StatCard.jsx
│   │       ├── ChartCard.jsx
│   │       ├── MiniLineChart.jsx
│   │       └── NumberedMarker.jsx
│   │
│   ├── hooks/
│   │   └── useWebSocket.js     # Hook WebSocket
│   │
│   └── utils/
│       ├── helpers.js
│       └── geo.js
│
├── public/                      # Statiques
└── dist/                        # Build prod (généré)
```

---

## 🛠 Stack Technique

| Aspect | Tech |
|--------|------|
| **Frontend** | React 19, Vite 7, Leaflet, React-Leaflet |
| **UI** | CSS custom, Lucide Icons |
| **Backend** | Node.js, Express 5, WebSocket (ws) |
| **Auth** | ApiKey + JWT (de l'API externe) |
| **Stockage** | RAM éphémère (pings, logs, events) |
| **BDD** | PostgreSQL (API externe en lecture) |
| **Build** | Vite (frontend) |
| **Deploy** | Docker + Docker Compose |
| **Lint** | ESLint 9 |

---

## 📝 Notes Importantes

- **Données volatiles** : pings, logs, events sont en RAM. Perdus au redémarrage (limites : 5k pings, 1k logs, 500 events).
- **100% API externe** : courses, équipes, balises, codes, tous les logins → API PostgreSQL externe.
- **Aucun compte local** : les organisateurs et admins sont authentifiés via l'API externe uniquement.
- **Auto-refresh API** : le backend vérifie la disponibilité de l'API externe toutes les 30s et log les changements d'état.
- **Proxy Vite (dev)** : redirige `/api/*` et `/ws` vers `localhost:8787`.
- **Prod** : Express sert le build frontend (`dist/`) + l'API sur un unique port.

---

## 📞 Support

Pour toute question ou bug, consultez les logs backend :

```bash
# Voir les logs en direct
tail -f logs.txt   # si fichier de log
# ou directement dans le terminal lors du lancement
npm run api
```
