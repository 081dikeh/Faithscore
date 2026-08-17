# FaithScore 🎼

**FaithScore is a web-based music notation and composition application for creating, editing, playing, and exporting both Staff and Tonic Sol-fa music.**

Built with a particular focus on **choir, SATB, and Sol-fa workflows**, FaithScore brings traditional music notation into an interactive digital workspace where musicians can write scores, hear their compositions, manage lyrics and dynamics, and work across multiple notation systems.

🔗 **Live Application:** [https://faithscore-6c35.vercel.app/](https://faithscore-6c35.vercel.app/)
🔗 **Repository:** [https://github.com/081dikeh/Faithscore](https://github.com/081dikeh/Faithscore)

---

## ✨ Overview

FaithScore was created to solve a practical problem: providing a single digital environment where musicians—especially **choristers, choir directors, music students, and composers**—can work with both traditional staff notation and Tonic Sol-fa.

Rather than treating Sol-fa as a simple text translation of staff notation, FaithScore implements it as a dedicated notation system with its own editor, renderer, playback engine, key/modulation logic, and score state.

The application currently supports:

* 🎼 Staff notation
* 🎵 Tonic Sol-fa notation
* 🎤 SATB and choir workflows
* 🎹 Piano and solo parts
* 🔑 Key signatures and modulation
* ⏱️ Multiple time signatures
* 🎶 Beaming and rhythmic grouping
* 3️⃣ Triplets and tuplets
* 🎚️ Dynamics and hairpins
* 📝 Lyrics
* 🔗 Slurs and ties
* ▶️ Audio playback
* 🔁 Looping and metronome functionality
* ↩️ Undo/redo
* 📄 MusicXML import/export
* 🎹 MIDI export
* 🖨️ Score printing
* ☁️ Cloud score storage
* 🔐 Authentication

---

# 🎼 Core Features

## Staff Notation

FaithScore provides an interactive staff notation editor supporting common musical notation elements including:

* Treble and bass clefs
* Notes and rests
* Accidentals
* Key signatures
* Time signatures
* Measures
* Beams
* Ties
* Slurs
* Tuplets
* Dynamics
* Lyrics
* Multiple voices/parts
* SATB arrangements

The rendering system is powered by **VexFlow**, while FaithScore's own application logic determines how musical structures should be represented and edited.

---

## 🎵 Tonic Sol-fa

FaithScore includes a dedicated Sol-fa environment built around:

**Do · Re · Mi · Fa · Sol · La · Ti**

The Sol-fa system has its own editor and renderer rather than simply displaying syllables generated from staff notation.

This allows users to create and edit Sol-fa music directly while maintaining musical concepts such as:

* Rhythm
* Octave
* Key
* Modulation
* Sustained notes
* Rests
* Triplets
* Lyrics
* Dynamics
* SATB parts

---

## 🎤 SATB & Choral Composition

FaithScore is particularly suited to choir arrangements.

Supported voice configurations include workflows for:

* Soprano
* Alto
* Tenor
* Bass
* Solo
* Piano

The playback engine also treats different vocal parts independently, allowing individual voice characteristics and playback behavior to be applied to SATB arrangements.

---

## 🔑 Key Signatures & Modulation

FaithScore supports changing keys within a score rather than treating the entire composition as having one permanent key.

For example:

```text
Measure 1–8
Key: A Major

Measure 9–16
Key: D Major

Measure 17–24
Key: A Major
```

The active key can therefore change throughout a composition.

This is particularly important for Sol-fa because the meaning of each syllable depends on the current tonic.

The application resolves the active key when rendering and playing Sol-fa notes, allowing modulation to affect both visual notation and playback.

---

## ⏱️ Time Signatures & Rhythm

FaithScore uses time signatures to determine the rhythmic structure of each measure.

Examples include:

* 2/4
* 3/4
* 4/4
* 6/8
* 9/8
* 12/8

Time signatures influence:

* Measure capacity
* Beat grouping
* Beaming
* Rhythmic validation
* Note placement
* Tuplet behavior

Special attention has been given to compound meters such as **6/8, 9/8, and 12/8**, where rhythmic grouping cannot simply be handled by counting individual notes.

---

## 🎶 Beaming

FaithScore implements custom rhythmic grouping logic to determine how notes should be beamed.

Beaming takes into account factors such as:

* Time signature
* Note duration
* Beat boundaries
* Simple vs compound meter
* Tuplets
* Rhythmic grouping

This prevents notes from being blindly connected simply because they occur consecutively.

---

## 3️⃣ Tuplets & Triplets

FaithScore supports triplets and other tuplet structures.

Tuplets are treated as rhythmic groups rather than simply as independent notes.

This affects:

* Duration calculations
* Measure validation
* Beaming
* Rendering
* Playback
* Sol-fa notation

---

## 🎚️ Dynamics

Dynamic markings and hairpins are supported within the score model.

The playback engine takes dynamics into account when determining note velocity and can interpolate changes across crescendo and decrescendo regions.

This allows playback to respond to musical expression instead of treating every note as having identical volume.

---

## 📝 Lyrics

FaithScore supports lyrics alongside musical notation.

A dedicated **Lyrics Mode** allows users to toggle lyric alignment guides when working with lyrics without unnecessarily cluttering the score during normal editing.

Lyrics remain part of the score while their editing guides can be shown or hidden depending on the user's workflow.

---

# ▶️ Playback Engine

FaithScore includes an integrated audio playback system powered by **Tone.js**.

Playback features include:

* Play
* Pause
* Stop
* Restart
* Loop
* Metronome
* Tempo control
* Playback position tracking
* Dynamic expression
* Articulations
* SATB playback
* Piano playback

The playback system schedules musical events according to the score's rhythmic structure rather than simply playing notes sequentially.

The Sol-fa playback engine additionally resolves syllables against the active key, allowing modulation to affect the resulting pitches.

---

# 📄 Import & Export

FaithScore is designed to work beyond its own internal score format.

### MusicXML

Supported operations include:

* Import MusicXML
* Export MusicXML

This allows scores to be exchanged with other notation software that supports the MusicXML standard.

### MIDI

Scores can also be exported as MIDI for use with compatible music-production and notation applications.

### Printing

FaithScore includes print functionality with configurable page settings such as:

* Page size
* Margins
* Score layout

---

# ☁️ Cloud Storage & Authentication

FaithScore integrates with **Supabase** for backend services.

The application supports authenticated users and cloud-based score storage, allowing musical work to be saved beyond the browser session.

The frontend communicates with Supabase through the Supabase JavaScript client.

---

# ↩️ Undo & Redo

Score editing is built around centralized application state with support for undo and redo operations.

This is particularly important for a notation editor because users frequently make structural edits involving:

* Notes
* Measures
* Rhythms
* Parts
* Key signatures
* Time signatures
* Lyrics
* Dynamics

---

# 🏗️ Architecture

FaithScore uses a component-based React architecture.

```text
src/
├── components/
│   ├── AuthScreen/
│   ├── HomeScreen/
│   ├── NoteEditor/
│   ├── PianoKeyboard/
│   ├── ScoreRenderer/
│   ├── Sidebar/
│   ├── SolfaApp/
│   ├── SolfaEditor/
│   ├── SolfaRenderer/
│   ├── SolfaSidebar/
│   ├── SolfaWizard/
│   └── Toolbar/
│
├── hooks/
│   ├── usePlayback.js
│   └── useSolfaPlayback.js
│
├── lib/
│   └── supabase.js
│
├── store/
│   ├── scoreStore.js
│   └── solfaStore.js
│
└── utils/
    ├── exportScore.js
    └── exportSolfa.js
```

### State Management

FaithScore uses **Zustand** for centralized score and Sol-fa state.

The score store manages information such as:

* Musical parts
* Measures
* Notes
* Time signatures
* Key signatures
* Tuplets
* Dynamics
* Hairpins
* Score settings
* Editing history

The Sol-fa store manages the corresponding Sol-fa score state and key/modulation resolution.

---

# 🛠️ Tech Stack

| Technology              | Purpose                          |
| ----------------------- | -------------------------------- |
| **React 19**            | Frontend application             |
| **JavaScript**          | Application and music logic      |
| **Tailwind CSS**        | UI styling                       |
| **Vite**                | Development and build tooling    |
| **Zustand**             | State management                 |
| **Zundo**               | Undo/redo state history          |
| **VexFlow 5**           | Staff notation rendering         |
| **Tone.js**             | Audio synthesis and playback     |
| **@tonejs/midi**        | MIDI functionality               |
| **MusicXML Interfaces** | MusicXML data handling           |
| **Supabase**            | Authentication and cloud storage |
| **Lucide React**        | UI icons                         |
| **Vercel**              | Deployment                       |

---

# 🚀 Getting Started

## Prerequisites

Make sure you have:

* Node.js
* npm
* A Supabase project if cloud functionality is required

## Installation

Clone the repository:

```bash
git clone https://github.com/081dikeh/Faithscore.git
cd Faithscore
```

Install dependencies:

```bash
npm install
```

Create your environment configuration for Supabase:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Start the development server:

```bash
npm run dev
```

The application will be available through the local Vite development server.

---

# 📦 Available Scripts

```bash
npm run dev
```

Starts the development server.

```bash
npm run build
```

Creates a production build.

```bash
npm run preview
```

Previews the production build locally.

```bash
npm run lint
```

Runs ESLint across the project.

---

# 🧠 Engineering Challenges

One of the most technically demanding aspects of FaithScore is translating **music theory into deterministic software behavior**.

The application is not simply rendering predefined images of musical notation.

It must continuously translate:

```text
Musical Input
      ↓
Score State
      ↓
Music Theory Rules
      ↓
Notation Logic
      ↓
Renderer
      ↓
Interactive Score
      ↓
Playback
```

This becomes particularly challenging with:

* Compound time signatures
* Rhythmic grouping
* Tuplets
* Key changes
* Modulation
* Accidentals
* Rest positioning
* SATB voice management
* Sol-fa pitch resolution
* Playback synchronization

These systems have required custom application logic around the underlying notation and audio libraries.

---

# 🎯 Project Vision

FaithScore is evolving toward a complete digital workspace for **choir music and music education**.

The long-term vision is to make it possible for users to:

> **Write, edit, hear, print, and share music using both Staff and Tonic Sol-fa notation from one application.**

Its primary differentiator is the combination of:

**Staff Notation + Tonic Sol-fa + Choir/SATB Workflows**

rather than focusing exclusively on traditional Western staff notation.

---

# 👨‍💻 About the Developer

FaithScore is designed and developed by **Dikeh Daniel**, a frontend developer with a particular interest in music technology and interactive web applications.

The project combines frontend engineering with practical music-domain knowledge, resulting in a product where musical concepts are translated directly into software behavior.

---

# 📸 Project

**FaithScore**

> A digital music notation workspace for Staff and Tonic Sol-fa composition.

**Live:** [https://faithscore-6c35.vercel.app/](https://faithscore-6c35.vercel.app/)
**GitHub:** [https://github.com/081dikeh/Faithscore](https://github.com/081dikeh/Faithscore)

---

## License

This project is currently maintained as a personal software project. Licensing and usage terms should be defined before distributing the source code publicly.
