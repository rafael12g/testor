# 🧭 Testor — Suivi de Course d'Orientation

Application web temps réel pour le suivi de courses d'orientation. Elle permet aux **organisateurs** de gérer les courses et balises, aux **participants** de rejoindre une course via un code d'équipe, et aux **administrateurs** de superviser l'ensemble depuis une console dédiée.

---

## 📋 Table des matières

- [Fonctionnalités](#-fonctionnalités)
- [Architecture](#-architecture)
- [Prérequis](#-prérequis)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Lancement](#-lancement)
- [Déploiement Docker](#-déploiement-docker)
- [API REST](#-api-rest)
- [WebSocket](#-websocket)
- [Structure du projet](#-structure-du-projet)
- [Stack technique](#-stack-technique)

---

## ✨ Fonctionnalités

### 👤 Participant (Runner)
- Rejoindre une course en entrant un **code d'équipe**
- Visualiser les balises sur une **carte Leaflet** interactive
- Suivre sa progression (balises validées / restantes)
- Voir l'ordre des checkpoints à atteindre

### 🔴 Administrateur
- Connexion via **username / mot de passe** (vérifié sur l'API externe)
- Vue globale de toutes les courses, balises et équipes
- **Logs serveur** en temps réel (mis à jour toutes les 3s)
- Historique des événements de course
- Système de **permissions granulaires** (accès courses, balises, équipes, état)

### ⚡ Temps réel
- **WebSocket** natif pour la diffusion instantanée des pings et événements
- Détection automatique **online/offline**
- Broadcast des beacon pings à tous les clients connectés

---

## 🏗 Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────────┐
│   Frontend   │◄─────►│   Backend Node   │◄─────►│   API Externe       │
│  React/Vite  │  HTTP │  Express + WS    │  HTTP │  (PostgreSQL BDD)   │
│  port 5173   │  WS   │  port 8787       │       │  port 3000          │
└──────────────┘       └──────────────────┘       └─────────────────────┘
```

- **Frontend** : SPA React servie par Vite (dev) ou Express (production)
- **Backend** : API REST Express + serveur WebSocket, stockage en mémoire (pings, logs, events)
- **API externe** : API distante avec base PostgreSQL (courses, équipes, balises, codes, utilisateurs). Authentification par clé API (`Authorization: ApiKey <clé>`)

---

## 📦 Prérequis

- **Node.js** ≥ 20
- **npm** ≥ 9
- Accès réseau à l'**API externe** (par défaut `http://172.40.1.151:3000`)
- *(Optionnel)* **Docker** + **Docker Compose** pour le déploiement

---

## 🚀 Installation

```bash
# Cloner le projet
git clone <url-du-repo>
cd testor

# Installer les dépendances
npm install

# Copier la configuration
cp .env.example .env
```

---

## ⚙️ Configuration

Éditer le fichier **`.env`** à la racine :

```env
# Port du serveur backend
PORT=8787

# URL de l'API externe (PostgreSQL)
API_URL=http://172.40.1.151:3000

# Clé API pour l'authentification auprès de l'API externe
API_KEY=votre_cle_api_ici
```

| Variable       | Description                                    | Défaut                   |
|----------------|------------------------------------------------|--------------------------|
| `PORT`         | Port d'écoute du backend                       | `8787`                   |
| `API_URL`      | URL de l'API externe (courses, équipes, codes) | —                        |
| `API_KEY`      | Clé API pour authentifier les requêtes         | —                        |
| `CORS_ORIGINS` | Origines CORS autorisées (séparées par `,`)    | *(toutes acceptées)*     |

---

## ▶️ Lancement

### Mode développement

Lance le backend Express **et** le serveur Vite simultanément :

```bash
npm run dev
```

- Frontend → [http://localhost:5173](http://localhost:5173)
- Backend API → [http://localhost:8787](http://localhost:8787)
- WebSocket → `ws://localhost:8787/ws`

### Commandes disponibles

| Commande            | Description                                  |
|---------------------|----------------------------------------------|
| `npm run dev`       | Lance API + Vite en parallèle (dev)          |
| `npm run api`       | Lance uniquement le serveur backend          |
| `npm run dev:front` | Lance uniquement Vite (frontend)             |
| `npm run build`     | Build de production du frontend              |
| `npm run preview`   | Prévisualise le build de production          |
| `npm run lint`      | Lint ESLint sur tout le projet               |

---

## 🐳 Déploiement Docker

Le projet inclut un **Dockerfile multi-stage** (build frontend + serveur production) et un `docker-compose.yml`.

```bash
# Lancer en production
npm run docker:up

# Voir les logs
npm run docker:logs

# Arrêter
npm run docker:down

# Reset complet (supprime les volumes)
npm run docker:reset
```

L'application est exposée sur le **port 80** en production.

> La config Docker utilise `.env.docker` comme fichier d'environnement.

---

## 📡 API REST

Toutes les routes sont préfixées par `/api`.

### Authentification

| Méthode | Route             | Description                       |
|---------|-------------------|-----------------------------------|
| `POST`  | `/api/auth/admin` | Login admin (username + password) |

**Body** : `{ "username": "...", "password": "..." }`

**Réponse** : `{ "ok": true, "permissions": { ... } }`

> Le login est vérifié via le endpoint `/api/auth/login` de l'API externe.

### Santé

| Méthode | Route         | Description                     |
|---------|---------------|---------------------------------|
| `GET`   | `/api/health` | État du backend + connexion API |

### Courses

| Méthode | Route                   | Description                              |
|---------|-------------------------|------------------------------------------|
| `GET`   | `/api/courses`          | Liste des courses (depuis l'API externe) |
| `GET`   | `/api/teams/code/:code` | Rejoindre une course par code d'équipe   |

### Beacon Pings

| Méthode | Route                        | Description                       |
|---------|------------------------------|-----------------------------------|
| `POST`  | `/api/beacons/ping`          | Enregistrer un ping de balise     |
| `GET`   | `/api/beacons/events`        | Derniers pings (tous les teams)   |
| `GET`   | `/api/races/:raceId/beacons` | Snapshot des positions par course |

**Body ping** :
```json
{
  "raceId": "1",
  "teamCode": "ALPHA1",
  "teamName": "Les Explorateurs",
  "lat": 48.8566,
  "lng": 2.3522,
  "accuracy": 5,
  "speedKmh": 8.2,
  "heading": 180,
  "battery": 85
}
```

### Événements de course

| Méthode | Route                        | Description                  |
|---------|------------------------------|------------------------------|
| `POST`  | `/api/races/:raceId/events`  | Créer un événement de course |
| `GET`   | `/api/races/:raceId/history` | Historique d'une course      |
| `GET`   | `/api/history`               | Historique global            |

### Logs serveur

| Méthode | Route       | Description         |
|---------|-------------|---------------------|
| `GET`   | `/api/logs` | Derniers logs       |

### Rate limiting

- Routes API générales : **120 requêtes / minute**
- Route d'authentification : **10 tentatives / 15 minutes**

---

## 🔌 WebSocket

Connexion sur `ws://localhost:8787/ws`.

### Messages reçus

| Type          | Description                      | Payload            |
|---------------|----------------------------------|--------------------|
| `connected`   | Confirmation de connexion        | `{ ok: true }`     |
| `beacon_ping` | Nouveau ping d'une balise/équipe | Objet ping complet |
| `race_event`  | Événement de course              | Objet event        |
| `log`         | Nouveau log serveur              | Objet log          |

---

## 📁 Structure du projet

```
testor/
├── .env                    # Configuration locale
├── .env.docker             # Configuration Docker
├── .env.example            # Template de configuration
├── docker-compose.yml      # Orchestration Docker
├── Dockerfile              # Build multi-stage (frontend + backend)
├── package.json            # Dépendances et scripts
├── vite.config.js          # Config Vite (proxy dev → backend)
├── eslint.config.js        # Config ESLint
├── index.html              # Point d'entrée HTML
│
├── server/                 # ── Backend Node.js ──
│   ├── index.js            # Serveur Express + WebSocket + routes API
│   └── db.js               # Stockage mémoire + connexion API externe
│
├── src/                    # ── Frontend React ──
│   ├── main.jsx            # Point d'entrée React
│   ├── App.jsx             # Composant racine (routing, état global)
│   ├── App.css             # Styles globaux
│   ├── api.js              # Fonctions fetch vers le backend
│   │
│   ├── components/
│   │   ├── LoginPage.jsx       # Page de connexion (admin + code équipe)
│   │   ├── AdminPanel.jsx      # Console admin (courses, logs, historique)
│   │   ├── RunnerPanel.jsx     # Vue participant (carte, progression)
│   │   ├── OrgaPanel.jsx       # Vue organisateur (stats, simulation)
│   │   ├── VueBeaconMap.jsx    # Carte des balises temps réel
│   │   └── ui/
│   │       ├── StatCard.jsx        # Carte de statistique
│   │       ├── ChartCard.jsx       # Conteneur de graphique
│   │       ├── MiniLineChart.jsx   # Mini graphique en ligne
│   │       └── NumberedMarker.jsx  # Marqueur numéroté sur la carte
│   │
│   ├── hooks/
│   │   └── useWebSocket.js     # Hook React pour la connexion WebSocket
│   │
│   └── utils/
│       ├── helpers.js          # Utilitaires (clamp, sanitize, normalizeCode)
│       └── geo.js              # Calculs géographiques (haversine, bearing)
│
└── public/                 # Fichiers statiques
```

---

## 🛠 Stack technique

| Couche      | Technologie                                      |
|-------------|--------------------------------------------------|
| Frontend    | React 19, Vite 7, Leaflet, React-Leaflet         |
| UI          | CSS custom (variables, responsive), Lucide icons  |
| Backend     | Node.js 20, Express 5, WebSocket (ws)             |
| Auth        | Clé API (`Authorization: ApiKey`) + login JWT     |
| Stockage    | En mémoire (pings, logs, events) — éphémère      |
| API externe | PostgreSQL via API REST distante                  |
| Build       | Vite (dev + production)                           |
| Déploiement | Docker multi-stage, Docker Compose                |
| Linting     | ESLint 9                                          |

---

## 📝 Notes

- Les **pings, logs et événements** sont stockés en mémoire RAM côté backend. Ils sont perdus au redémarrage du serveur (max 5 000 pings, 1 000 logs, 500 events).
- Les **courses, équipes, balises et codes** sont lus depuis l'**API externe** PostgreSQL en lecture seule.
- Le proxy Vite (en dev) redirige `/api/*` et `/ws` vers le backend sur le port 8787.
- En production (Docker), Express sert directement le build frontend (`dist/`) + l'API sur le même port.
