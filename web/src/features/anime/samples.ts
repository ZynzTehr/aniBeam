// Written by scripts/refresh-samples.ts (`npm run samples`). To change the titles, edit
// its list and run it again.
import type { Media } from './queries.ts'

/** Well-known titles for a section to show when it can't reach AniList (see fallback.ts). */
export const SAMPLES: Media[] = [
  {
    id: 154587,
    title: {
      romaji: 'Sousou no Frieren',
      english: 'Frieren: Beyond Journey’s End',
      native: '葬送のフリーレン',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-qQTzQnEJJ3oB.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-qQTzQnEJJ3oB.jpg',
      color: '#bbf1a1',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587-ivXNJ23SM1xB.jpg',
    genres: ['Adventure', 'Drama', 'Fantasy'],
    averageScore: 91,
    format: 'TV',
    episodes: 28,
    season: 'FALL',
    seasonYear: 2023,
    studios: { nodes: [{ name: 'MADHOUSE' }] },
    nextAiringEpisode: null,
  },
  {
    id: 140960,
    title: { romaji: 'SPY×FAMILY', english: 'SPY x FAMILY', native: 'SPY×FAMILY' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx140960-Kb6R5nYQfjmP.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx140960-Kb6R5nYQfjmP.jpg',
      color: '#c9f1f1',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/140960-Z7xSvkRxHKfj.jpg',
    genres: ['Action', 'Comedy', 'Slice of Life', 'Supernatural'],
    averageScore: 83,
    format: 'TV',
    episodes: 12,
    season: 'SPRING',
    seasonYear: 2022,
    studios: { nodes: [{ name: 'CloverWorks' }, { name: 'WIT STUDIO' }] },
    nextAiringEpisode: null,
  },
  {
    id: 130003,
    title: {
      romaji: 'Bocchi the Rock!',
      english: 'BOCCHI THE ROCK!',
      native: 'ぼっち・ざ・ろっく！',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx130003-HTDmeL4RGeJ4.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx130003-HTDmeL4RGeJ4.png',
      color: '#e4bb50',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/130003-5F90a7BtsPQN.jpg',
    genres: ['Comedy', 'Music', 'Slice of Life'],
    averageScore: 87,
    format: 'TV',
    episodes: 12,
    season: 'FALL',
    seasonYear: 2022,
    studios: { nodes: [{ name: 'CloverWorks' }] },
    nextAiringEpisode: null,
  },
  {
    id: 113415,
    title: { romaji: 'Jujutsu Kaisen', english: 'JUJUTSU KAISEN', native: '呪術廻戦' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-LHBAeoZDIsnF.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx113415-LHBAeoZDIsnF.jpg',
      color: '#e45d5d',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-jQBSkxWAAk83.jpg',
    genres: ['Action', 'Drama', 'Supernatural'],
    averageScore: 84,
    format: 'TV',
    episodes: 24,
    season: 'FALL',
    seasonYear: 2020,
    studios: { nodes: [{ name: 'MAPPA' }] },
    nextAiringEpisode: null,
  },
  {
    id: 161645,
    title: {
      romaji: 'Kusuriya no Hitorigoto',
      english: 'The Apothecary Diaries',
      native: '薬屋のひとりごと',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx161645-QLbzHXiYRgV2.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx161645-QLbzHXiYRgV2.jpg',
      color: '#f1865d',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/161645-oqzTZYIvviWI.jpg',
    genres: ['Drama', 'Mystery'],
    averageScore: 88,
    format: 'TV',
    episodes: 24,
    season: 'FALL',
    seasonYear: 2023,
    studios: { nodes: [{ name: 'OLM' }, { name: 'TOHO animation STUDIO' }] },
    nextAiringEpisode: null,
  },
  {
    id: 16498,
    title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-buvcRTBx4NSm.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-buvcRTBx4NSm.jpg',
      color: '#f1a143',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498-8jpFCOcDmneX.jpg',
    genres: ['Action', 'Drama', 'Fantasy', 'Mystery'],
    averageScore: 85,
    format: 'TV',
    episodes: 25,
    season: 'SPRING',
    seasonYear: 2013,
    studios: { nodes: [{ name: 'WIT STUDIO' }] },
    nextAiringEpisode: null,
  },
  {
    id: 21519,
    title: { romaji: 'Kimi no Na wa.', english: 'Your Name.', native: '君の名は。' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21519-SUo3ZQuCbYhJ.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21519-SUo3ZQuCbYhJ.png',
      color: '#0da1e4',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21519-1ayMXgNlmByb.jpg',
    genres: ['Drama', 'Romance', 'Supernatural'],
    averageScore: 85,
    format: 'MOVIE',
    episodes: 1,
    season: 'SUMMER',
    seasonYear: 2016,
    studios: { nodes: [{ name: 'CoMix Wave' }] },
    nextAiringEpisode: null,
  },
  {
    id: 9253,
    title: { romaji: 'Steins;Gate', english: 'Steins;Gate', native: 'シュタインズ・ゲート' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx9253-tIUXF2gfU8Sg.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx9253-tIUXF2gfU8Sg.jpg',
      color: '#ffd6ae',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/n9253-JIhmKgBKsWUN.jpg',
    genres: ['Drama', 'Psychological', 'Sci-Fi', 'Thriller'],
    averageScore: 89,
    format: 'TV',
    episodes: 24,
    season: 'SPRING',
    seasonYear: 2011,
    studios: { nodes: [{ name: 'WHITE FOX' }] },
    nextAiringEpisode: null,
  },
  {
    id: 20464,
    title: { romaji: 'Haikyuu!!', english: 'HAIKYU!!', native: 'ハイキュー!!' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx20464-ooZUyBe4ptp9.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20464-ooZUyBe4ptp9.png',
      color: '#e48635',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/20464-PpYjO9cPN1gs.jpg',
    genres: ['Comedy', 'Drama', 'Sports'],
    averageScore: 83,
    format: 'TV',
    episodes: 25,
    season: 'SPRING',
    seasonYear: 2014,
    studios: { nodes: [{ name: 'Production I.G' }] },
    nextAiringEpisode: null,
  },
  {
    id: 21827,
    title: {
      romaji: 'Violet Evergarden',
      english: 'Violet Evergarden',
      native: 'ヴァイオレット・エヴァーガーデン',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21827-ubzq619ZA2E9.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21827-ubzq619ZA2E9.png',
      color: '#3586e4',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21827-ROucgYiiiSpR.jpg',
    genres: ['Drama', 'Fantasy', 'Slice of Life'],
    averageScore: 85,
    format: 'TV',
    episodes: 13,
    season: 'WINTER',
    seasonYear: 2018,
    studios: { nodes: [{ name: 'Kyoto Animation' }] },
    nextAiringEpisode: null,
  },
  {
    id: 199,
    title: {
      romaji: 'Sen to Chihiro no Kamikakushi',
      english: 'Spirited Away',
      native: '千と千尋の神隠し',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx199-sWefXJvXkDOb.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx199-sWefXJvXkDOb.jpg',
      color: '#e45d5d',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/199-Sm2RU5PSqw7T.jpg',
    genres: ['Adventure', 'Drama', 'Fantasy', 'Supernatural'],
    averageScore: 86,
    format: 'MOVIE',
    episodes: 1,
    season: 'SUMMER',
    seasonYear: 2001,
    studios: { nodes: [{ name: 'Studio Ghibli' }] },
    nextAiringEpisode: null,
  },
  {
    id: 5114,
    title: {
      romaji: 'Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST',
      english: 'Fullmetal Alchemist: Brotherhood',
      native: '鋼の錬金術師 FULLMETAL ALCHEMIST',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx5114-nSWCgQlmOMtj.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx5114-nSWCgQlmOMtj.jpg',
      color: '#e4c993',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/5114-q0V5URebphSG.jpg',
    genres: ['Action', 'Adventure', 'Drama', 'Fantasy'],
    averageScore: 90,
    format: 'TV',
    episodes: 64,
    season: 'SPRING',
    seasonYear: 2009,
    studios: { nodes: [{ name: 'bones' }] },
    nextAiringEpisode: null,
  },
  {
    id: 1575,
    title: {
      romaji: 'Code Geass: Hangyaku no Lelouch',
      english: 'Code Geass: Lelouch of the Rebellion',
      native: 'コードギアス 反逆のルルーシュ',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1575-hsmWM2ydNm1m.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1575-hsmWM2ydNm1m.jpg',
      color: '#c9d678',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1575.jpg',
    genres: ['Action', 'Drama', 'Mecha', 'Sci-Fi', 'Thriller'],
    averageScore: 85,
    format: 'TV',
    episodes: 25,
    season: 'FALL',
    seasonYear: 2006,
    studios: { nodes: [{ name: 'Sunrise' }] },
    nextAiringEpisode: null,
  },
  {
    id: 5680,
    title: { romaji: 'K-ON!', english: 'K-ON!', native: 'けいおん!' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx5680-r3AI3Cwfv0Aq.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx5680-r3AI3Cwfv0Aq.png',
      color: '#e47843',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/5680-Mc9n4eFI4i0Y.jpg',
    genres: ['Comedy', 'Music', 'Slice of Life'],
    averageScore: 78,
    format: 'TV',
    episodes: 13,
    season: 'SPRING',
    seasonYear: 2009,
    studios: { nodes: [{ name: 'Kyoto Animation' }] },
    nextAiringEpisode: null,
  },
  {
    id: 457,
    title: { romaji: 'Mushishi', english: 'MUSHI-SHI', native: '蟲師' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx457-l6cTtNgI9Bi6.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx457-l6cTtNgI9Bi6.png',
      color: '#d6bb78',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/n457-sWOJfqYC7s2I.jpg',
    genres: ['Adventure', 'Fantasy', 'Mystery', 'Psychological', 'Slice of Life', 'Supernatural'],
    averageScore: 84,
    format: 'TV',
    episodes: 26,
    season: 'FALL',
    seasonYear: 2005,
    studios: { nodes: [{ name: 'Artland' }] },
    nextAiringEpisode: null,
  },
  {
    id: 1,
    title: { romaji: 'Cowboy Bebop', english: 'Cowboy Bebop', native: 'カウボーイビバップ' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-GCsPm7waJ4kS.png',
      large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1-GCsPm7waJ4kS.png',
      color: '#f16b50',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1-OquNCNB6srGe.jpg',
    genres: ['Action', 'Adventure', 'Drama', 'Sci-Fi'],
    averageScore: 86,
    format: 'TV',
    episodes: 26,
    season: 'SPRING',
    seasonYear: 1998,
    studios: { nodes: [{ name: 'Sunrise' }] },
    nextAiringEpisode: null,
  },
  {
    id: 30,
    title: {
      romaji: 'Shin Seiki Evangelion',
      english: 'Neon Genesis Evangelion',
      native: '新世紀エヴァンゲリオン',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx30-AI1zr74Dh4ye.jpg',
      large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx30-AI1zr74Dh4ye.jpg',
      color: '#f17843',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/30-gEMoHHIqxDgN.jpg',
    genres: ['Action', 'Drama', 'Mecha', 'Mystery', 'Psychological', 'Sci-Fi'],
    averageScore: 83,
    format: 'TV',
    episodes: 26,
    season: 'FALL',
    seasonYear: 1995,
    studios: { nodes: [{ name: 'GAINAX' }, { name: 'Tatsunoko Production' }] },
    nextAiringEpisode: null,
  },
  {
    id: 245,
    title: { romaji: 'GTO', english: 'GTO: Great Teacher Onizuka', native: 'GTO' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx245-NcQAyTipUMeO.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx245-NcQAyTipUMeO.jpg',
      color: '#e4930d',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/245-sIPMF9vNDnaJ.jpg',
    genres: ['Comedy', 'Drama', 'Slice of Life'],
    averageScore: 84,
    format: 'TV',
    episodes: 43,
    season: 'SUMMER',
    seasonYear: 1999,
    studios: { nodes: [{ name: 'Studio Pierrot' }] },
    nextAiringEpisode: null,
  },
  {
    id: 232,
    title: {
      romaji: 'Cardcaptor Sakura',
      english: 'Cardcaptor Sakura',
      native: 'カードキャプターさくら',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx232-ERyKCNNPJJeh.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx232-ERyKCNNPJJeh.png',
      color: '#f1d65d',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/232-jnE0kGIWIRIS.jpg',
    genres: ['Comedy', 'Drama', 'Fantasy', 'Mahou Shoujo', 'Romance'],
    averageScore: 81,
    format: 'TV',
    episodes: 70,
    season: 'SPRING',
    seasonYear: 1998,
    studios: { nodes: [{ name: 'MADHOUSE' }] },
    nextAiringEpisode: null,
  },
  {
    id: 585,
    title: { romaji: 'Mimi wo Sumaseba', english: 'Whisper of the Heart', native: '耳をすませば' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/nx585-5uq7j2xNNVmN.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/nx585-5uq7j2xNNVmN.jpg',
      color: '#f15d35',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/585-GowCYxa1c8WR.jpg',
    genres: ['Adventure', 'Drama', 'Romance', 'Slice of Life'],
    averageScore: 81,
    format: 'MOVIE',
    episodes: 1,
    season: 'SUMMER',
    seasonYear: 1995,
    studios: { nodes: [{ name: 'Studio Ghibli' }] },
    nextAiringEpisode: null,
  },
  {
    id: 523,
    title: { romaji: 'Tonari no Totoro', english: 'My Neighbor Totoro', native: 'となりのトトロ' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx523-fErBvxOHP7IX.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx523-fErBvxOHP7IX.jpg',
      color: '#f19335',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/523-rl12Q0av1fCr.jpg',
    genres: ['Adventure', 'Fantasy', 'Slice of Life', 'Supernatural'],
    averageScore: 81,
    format: 'MOVIE',
    episodes: 1,
    season: 'SPRING',
    seasonYear: 1988,
    studios: { nodes: [{ name: 'Studio Ghibli' }] },
    nextAiringEpisode: null,
  },
  {
    id: 47,
    title: { romaji: 'AKIRA', english: 'Akira', native: 'AKIRA' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx47-4CR68arv452h.jpg',
      large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx47-4CR68arv452h.jpg',
      color: '#e45d50',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/47-fof8HqtNDtvx.jpg',
    genres: ['Action', 'Adventure', 'Horror', 'Psychological', 'Sci-Fi', 'Supernatural'],
    averageScore: 79,
    format: 'MOVIE',
    episodes: 1,
    season: 'SUMMER',
    seasonYear: 1988,
    studios: { nodes: [{ name: 'Tokyo Movie Shinsha' }] },
    nextAiringEpisode: null,
  },
  {
    id: 512,
    title: {
      romaji: 'Majo no Takkyuubin',
      english: "Kiki's Delivery Service",
      native: '魔女の宅急便',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx512-UwP8X4BR8YoM.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx512-UwP8X4BR8YoM.png',
      color: '#50a1c9',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/512-Ssp3EE2NdeoA.jpg',
    genres: ['Adventure', 'Drama', 'Fantasy', 'Slice of Life'],
    averageScore: 81,
    format: 'MOVIE',
    episodes: 1,
    season: 'SUMMER',
    seasonYear: 1989,
    studios: { nodes: [{ name: 'Studio Ghibli' }] },
    nextAiringEpisode: null,
  },
  {
    id: 223,
    title: { romaji: 'Dragon Ball', english: 'Dragon Ball', native: 'ドラゴンボール' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx223-scE5uJfXqqj8.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx223-scE5uJfXqqj8.png',
      color: '#e48635',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/223-vyRuUBBYfcUb.jpg',
    genres: ['Action', 'Adventure', 'Comedy', 'Fantasy', 'Sci-Fi', 'Supernatural'],
    averageScore: 78,
    format: 'TV',
    episodes: 153,
    season: 'WINTER',
    seasonYear: 1986,
    studios: { nodes: [{ name: 'Toei Animation' }] },
    nextAiringEpisode: null,
  },
  {
    id: 80,
    title: {
      romaji: 'Kidou Senshi Gundam',
      english: 'Mobile Suit Gundam',
      native: '機動戦士ガンダム',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx80-pdYJ12vSTmad.jpg',
      large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx80-pdYJ12vSTmad.jpg',
      color: '#e48650',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/80-LcQhJ600WeDn.jpg',
    genres: ['Drama', 'Mecha', 'Sci-Fi'],
    averageScore: 77,
    format: 'TV',
    episodes: 43,
    season: 'SPRING',
    seasonYear: 1979,
    studios: { nodes: [{ name: 'Sunrise' }] },
    nextAiringEpisode: null,
  },
  {
    id: 1430,
    title: {
      romaji: 'Lupin III: Cagliostro no Shiro',
      english: 'Lupin The 3rd: The Castle of Cagliostro',
      native: 'ルパン三世 カリオストロの城',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1430-aHneeSPBCeHR.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1430-aHneeSPBCeHR.jpg',
      color: '#ae7835',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1430-QnrZxbYONXfh.jpg',
    genres: ['Action', 'Adventure', 'Comedy', 'Mystery'],
    averageScore: 80,
    format: 'MOVIE',
    episodes: 1,
    season: 'FALL',
    seasonYear: 1979,
    studios: { nodes: [{ name: 'Tokyo Movie Shinsha' }] },
    nextAiringEpisode: null,
  },
  {
    id: 2225,
    title: {
      romaji: 'Alps no Shoujo Heidi',
      english: 'Heidi, Girl of the Alps',
      native: 'アルプスの少女ハイジ',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx2225-UqDX9Rd9Do8P.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx2225-UqDX9Rd9Do8P.jpg',
      color: '#f1bb0d',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/n2225-6d6IlL0wuPr7.jpg',
    genres: ['Drama', 'Slice of Life'],
    averageScore: 72,
    format: 'TV',
    episodes: 52,
    season: 'WINTER',
    seasonYear: 1974,
    studios: { nodes: [{ name: 'Zuiyou Eizou' }] },
    nextAiringEpisode: null,
  },
  {
    id: 1044,
    title: {
      romaji: 'Taiyou no Ouji: Horus no Daibouken',
      english: 'The Little Norse Prince',
      native: '太陽の王子 ホルスの大冒険',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1044-Z3nShiFF7x5p.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1044-Z3nShiFF7x5p.jpg',
      color: '#d61a35',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1044-tEPPoVubLNew.jpg',
    genres: ['Action', 'Adventure', 'Drama', 'Fantasy'],
    averageScore: 63,
    format: 'MOVIE',
    episodes: 1,
    season: 'SUMMER',
    seasonYear: 1968,
    studios: { nodes: [{ name: 'Toei Animation' }] },
    nextAiringEpisode: null,
  },
  {
    id: 1550,
    title: { romaji: 'Attack No.1', english: null, native: 'アタックNo.1' },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1550-bhaPXtT9dk2h.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1550-bhaPXtT9dk2h.png',
      color: '#f1bb00',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1550-UWVAdQvlFnQ0.jpg',
    genres: ['Drama', 'Sports'],
    averageScore: 65,
    format: 'TV',
    episodes: 104,
    season: 'FALL',
    seasonYear: 1969,
    studios: { nodes: [{ name: 'Tokyo Movie Shinsha' }] },
    nextAiringEpisode: null,
  },
  {
    id: 1445,
    title: { romaji: 'Mach GoGoGo', english: 'Speed Racer', native: 'マッハ　ＧｏＧｏＧｏ' },
    coverImage: {
      extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/1445.jpg',
      large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/1445.jpg',
      color: '#e43543',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/n1445-rfPhOQSGRe0i.jpg',
    genres: ['Action', 'Adventure', 'Sports'],
    averageScore: 64,
    format: 'TV',
    episodes: 52,
    season: 'SPRING',
    seasonYear: 1967,
    studios: { nodes: [{ name: 'Tatsunoko Production' }] },
    nextAiringEpisode: null,
  },
]
