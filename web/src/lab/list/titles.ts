// The lab's titles that the bundled samples lack (see ListLab.tsx), so it asks AniList for nothing:
// 207329 and One Piece (21) from the browser checks' recordings (e2e/anilist/, the searches for
// them), and Ten Tokyo Warriors (1052) from the title lab's saved copy (#26), which saved no
// running time or tags for it. Shaped by cardOf, as the lists keep a title. Generated, then
// formatted; not edited by hand.
import type { Media } from '../../features/anime/queries.ts'

export const EXTRA: Media[] = [
  {
    id: 1052,
    title: {
      romaji: 'Tokyo Juushouden',
      english: 'Ten Tokyo Warriors',
      native: '倒凶十将伝',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b1052-WibX4en0qto6.jpg',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b1052-WibX4en0qto6.jpg',
      color: '#d6351a',
    },
    bannerImage: null,
    genres: ['Action', 'Adventure', 'Supernatural'],
    averageScore: 43,
    format: 'OVA',
    episodes: 3,
    season: 'SUMMER',
    seasonYear: 1999,
    studios: {
      nodes: [
        {
          name: 'ZEXCS',
        },
      ],
    },
    nextAiringEpisode: null,
    description:
      'Long ago, in feudal Japan, there was a fierce warrior named the Demon King. He controlled a band of demons, known as the Kyouma. Only the powers of ten warriors sealed the Demon King away and kept the Kyouma under control. But now, Lord Shindigan, a powerful Kyouma is planning to free the Demon King, and the reincarnations of the ten warriors must band together and save the earth.\n<br><br>\n(Source: Anime News Network)',
    duration: null,
    tags: [],
    trailer: null,
  },
  {
    id: 207329,
    title: {
      romaji:
        'Tsuihou Sareta Cheat Fuyo Majutsushi wa Kimama na Second Life wo Ouka Suru.: Ore wa Buki dake ja Naku, Arayuru Mono ni "Kyouka Point" wo Fuyo Dekiru shi, Ore no Ishi de Itsudemo Kouka wo Kaijo Dekiru kedo, Nokotta Hitotachi Daijoubu?',
      english: 'The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life',
      native:
        '追放されたチート付与魔術師は気ままなセカンドライフを謳歌する。　～俺は武器だけじゃなく、あらゆるものに『強化ポイント』を付与できるし、俺の意思でいつでも効果を解除できるけど、残った人たち大丈夫？～',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b207329-6VPeZIDfF4Sr.png',
      large:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b207329-6VPeZIDfF4Sr.png',
      color: '#f1e4c9',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/207329-9IqRSKIsM3TC.jpg',
    genres: ['Adventure', 'Comedy', 'Fantasy', 'Slice of Life'],
    averageScore: 74,
    format: 'TV',
    episodes: null,
    season: 'FALL',
    seasonYear: 2026,
    studios: {
      nodes: [
        {
          name: 'P.A.WORKS',
        },
      ],
    },
    nextAiringEpisode: {
      episode: 4,
      airingAt: 1793113200,
    },
    description:
      'Rein, an enchanter, is suddenly expelled from his guild one day. But instead of despairing, he declares, “Now I can do anything!” and begins reclaiming the massive number of enhancement points he once poured into his guildmates’ gear, setting off on a brand-new path as an adventurer.<br><br>\nGathering around him are people carrying wounds that don’t fade easily: a genius adventurer who shut her heart after her party was slaughtered, a warrior who lost her family, and an assassin raised from childhood to kill. Yet Rein never rejects their pasts or their scars—he accepts them all with bright, straightforward warmth.<br><br>\nThe stage is a unique fantasy world where Uzis, slingshots, and even yakuza exist side by side. But in this world, the more people rely on convenient technology, the more their magic weakens, and adventurers grow fragile.<br><br>\nIntelligent, vicious monsters roam freely, while in the underworld, outlaws bare their greed and ambition as schemes and betrayals intertwine. In a world where ideals and justice are easily crushed, adventurers fight on with nothing but their magic and their convictions.<br><br>\nThis is the story of those who have lost their place in the world finding a new way to live. Rein and his companions’ wild, free-spirited second life begins now!\n<br><br>(Source: The Laid-Off Cheat-Granting Mage Enjoys a Second Lease on Life Site)',
    duration: 24,
    tags: [
      {
        name: 'Surreal Comedy',
        rank: 92,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Urban Fantasy',
        rank: 79,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Found Family',
        rank: 79,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Slapstick',
        rank: 73,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Magic',
        rank: 66,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Chibi',
        rank: 66,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Exiled',
        rank: 66,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Male Protagonist',
        rank: 60,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Rehabilitation',
        rank: 20,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
      {
        name: 'Revenge',
        rank: 20,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
    ],
    trailer: {
      id: 'BJXBr_aFF8s',
      site: 'youtube',
    },
  },
  {
    id: 21,
    title: {
      romaji: 'ONE PIECE',
      english: 'ONE PIECE',
      native: 'ONE PIECE',
    },
    coverImage: {
      extraLarge:
        'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-ELSYx3yMPcKM.jpg',
      large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg',
      color: '#e49335',
    },
    bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-wf37VakJmZqs.jpg',
    genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'],
    averageScore: 87,
    format: 'TV',
    episodes: null,
    season: 'FALL',
    seasonYear: 1999,
    studios: {
      nodes: [
        {
          name: 'Toei Animation',
        },
      ],
    },
    nextAiringEpisode: {
      episode: 1181,
      airingAt: 1798985760,
    },
    description:
      "Gold Roger was known as the Pirate King, the strongest and most infamous being to have sailed the Grand Line. The capture and death of Roger by the World Government brought a change throughout the world. His last words before his death revealed the location of the greatest treasure in the world, One Piece. It was this revelation that brought about the Grand Age of Pirates, men who dreamed of finding One Piece (which promises an unlimited amount of riches and fame), and quite possibly the most coveted of titles for the person who found it, the title of the Pirate King.<br><br>\nEnter Monkey D. Luffy, a 17-year-old boy that defies your standard definition of a pirate. Rather than the popular persona of a wicked, hardened, toothless pirate who ransacks villages for fun, Luffy’s reason for being a pirate is one of pure wonder; the thought of an exciting adventure and meeting new and intriguing people, along with finding One Piece, are his reasons of becoming a pirate. Following in the footsteps of his childhood hero, Luffy and his crew travel across the Grand Line, experiencing crazy adventures, unveiling dark mysteries and battling strong enemies, all in order to reach One Piece.<br><br>\n<b>*This includes the following special episodes:</b><br>\n- Chopperman to the Rescue! Protect the TV Station by the Shore! (Episode 336)<br>\n- The Strongest Tag-Team! Luffy and Toriko's Hard Struggle! (Episode 492)<br>\n- Team Formation! Save Chopper (Episode 542)<br>\n- History's Strongest Collaboration vs. Glutton of the Sea (Episode 590)<br>\n- 20th Anniversary! Special Romance Dawn (Episode 907)",
    duration: 24,
    tags: [
      {
        name: 'Pirates',
        rank: 98,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Travel',
        rank: 94,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Shounen',
        rank: 93,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Ensemble Cast',
        rank: 93,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Super Power',
        rank: 90,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Found Family',
        rank: 88,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Male Protagonist',
        rank: 83,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Ships',
        rank: 81,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: false,
      },
      {
        name: 'Tragedy',
        rank: 81,
        isAdult: false,
        isGeneralSpoiler: true,
        isMediaSpoiler: true,
      },
      {
        name: 'Time Skip',
        rank: 79,
        isAdult: false,
        isGeneralSpoiler: true,
        isMediaSpoiler: true,
      },
      {
        name: 'Slavery',
        rank: 76,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
      {
        name: 'Gods',
        rank: 73,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
      {
        name: 'Henshin',
        rank: 67,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
      {
        name: 'Philosophy',
        rank: 65,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
      {
        name: 'Prison',
        rank: 61,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
      {
        name: 'Espionage',
        rank: 60,
        isAdult: false,
        isGeneralSpoiler: false,
        isMediaSpoiler: true,
      },
    ],
    trailer: null,
  },
]
