n# Group 4 Project: Notes App (with an in-memory REST API)

A note-taking web app that talks to its own REST API. **There is no database**: every note
lives in the server's memory, so restarting the server gives you a clean slate. Use
**Export / Import** to keep your notes between sessions.

Built with plain Node.js (no npm packages to install) and vanilla JavaScript.

## Run it

```bash
node server.js          # or: npm start
```

Open http://localhost:3000 in your browser (do **not** double-click `index.html`; it must be served by the server). Use `PORT=4000 node server.js` for another port. Requires Node 16+.

## Features

**Core**
- Create, read, edit, delete notes through the API (the front end uses `fetch` against `/api`)
- Autosave while you type (debounced) with a live save status

**Extras**
- Markdown editor with live **Split / Edit / Preview** modes and a formatting toolbar (safe renderer, HTML is escaped)
- Pin notes, colour-code notes, tag notes, filter by tag and colour
- Full-text search (title, content, tags) and sorting (last edited, newest, A-Z, longest)
- **Version history**: automatic snapshots with one-click restore
- **Archive** and **Trash** (soft delete, restore, delete forever, empty trash)
- Duplicate a note, download a note as `.md`
- **Export / Import** all notes as JSON (the way to persist data without a database)
- Stats dashboard (word counts, reading time, notes created in the last 7 days)
- Dark / light theme (remembers your choice), responsive layout, toast notifications
- Keyboard shortcuts: `Alt+N` new, `Ctrl+K` search, `Ctrl+S` save now, `Ctrl+/` toggle preview

**API quality**
- Input validation with clear error messages and correct HTTP status codes
- Pagination, filtering and sorting on list endpoint
- Rate limiting (300 requests/min per IP), request logging, CORS, 2MB body limit

## API reference

Base URL: `http://localhost:3000/api` (GET `/api` lists all endpoints)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Server status |
| GET | `/stats` | Aggregate statistics |
| GET | `/tags` | Tags with usage counts |
| GET | `/notes` | List notes. Query: `q`, `tag`, `color`, `view` (active/archived/trash), `sort` (updated/created/title/words), `order` (asc/desc), `page`, `limit` |
| POST | `/notes` | Create a note |
| GET | `/notes/:id` | Get one note |
| PUT / PATCH | `/notes/:id` | Update fields (partial updates allowed) |
| DELETE | `/notes/:id` | Move to trash (`?permanent=true` to erase) |
| POST | `/notes/:id/restore` | Restore from trash |
| POST | `/notes/:id/duplicate` | Duplicate a note |
| GET | `/notes/:id/versions` | List saved versions |
| POST | `/notes/:id/versions/:versionId/restore` | Restore a version |
| DELETE | `/trash` | Empty the trash |
| GET | `/export` | Download all notes as JSON |
| POST | `/import` | Import `{ "notes": [...] }` |

Note fields: `title` (string, max 200), `content` (string, max 100,000), `tags` (up to 10 strings),
`color` (`default|red|orange|yellow|green|blue|purple`), `pinned` (boolean), `archived` (boolean).

### Examples

```bash
curl -X POST localhost:3000/api/notes -H "Content-Type: application/json" \
  -d '{"title":"Shopping","content":"- milk\n- eggs","tags":["home"],"color":"green"}'

curl "localhost:3000/api/notes?q=milk&sort=title"

curl -X PATCH localhost:3000/api/notes/<id> -H "Content-Type: application/json" -d '{"pinned":true}'

curl -X DELETE localhost:3000/api/notes/<id>
```

## Project structure

```
server.js     API + static file server (in-memory Map as the "store")
index.html    App markup
style.css     Styling (light/dark themes, responsive)
app.js        Front end logic and API client
```
