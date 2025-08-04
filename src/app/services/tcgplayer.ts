import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface PokemonCard {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  hp: string;
  types: string[];
  evolvesFrom?: string;
  attacks: Array<{
    name: string;
    cost: string[];
    convertedEnergyCost: number;
    damage: string;
    text: string;
  }>;
  weaknesses?: Array<{
    type: string;
    value: string;
  }>;
  resistances?: Array<{
    type: string;
    value: string;
  }>;
  retreatCost?: string[];
  set: {
    name: string;
    series: string;
    releaseDate: string;
    images: {
      symbol: string;
      logo: string;
    };
  };
  number: string;
  artist: string;
  rarity: string;
  flavorText?: string;
  images: {
    small: string;
    large: string;
  };
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices: {
      holofoil?: {
        low?: number;
        mid?: number;
        high?: number;
        market?: number;
        directLow?: number;
      };
      normal?: {
        low?: number;
        mid?: number;
        high?: number;
        market?: number;
        directLow?: number;
      };
      reverseHolofoil?: {
        low?: number;
        mid?: number;
        high?: number;
        market?: number;
        directLow?: number;
      };
    };
  };
}

export interface PokemonCardResponse {
  data: PokemonCard[];
}

@Injectable({
  providedIn: 'root'
})
export class TcgplayerService {
  private readonly baseUrl = 'https://api.pokemontcg.io/v2';
  private readonly apiKey = '4ab5c6f8-912b-4929-8e02-061f51bbecce';
  private readonly mockCards: { [key: string]: PokemonCard } = {
    'swsh4-25': {
      id: 'swsh4-25',
      name: 'Pikachu V',
      supertype: 'Pokémon',
      subtypes: ['Basic', 'V'],
      hp: '190',
      types: ['Lightning'],
      attacks: [{
        name: 'Thunderbolt',
        cost: ['Lightning', 'Lightning', 'Lightning'],
        convertedEnergyCost: 3,
        damage: '160',
        text: 'Discard all Energy attached to this Pokémon.'
      }],
      set: {
        name: 'Vivid Voltage',
        series: 'Sword & Shield',
        releaseDate: '2020-11-13',
        images: {
          symbol: 'https://images.pokemontcg.io/swsh4/symbol.png',
          logo: 'https://images.pokemontcg.io/swsh4/logo.png'
        }
      },
      number: '25',
      artist: 'Yuya Oka',
      rarity: 'Rare Ultra',
      images: {
        small: 'https://images.pokemontcg.io/swsh4/25.png',
        large: 'https://images.pokemontcg.io/swsh4/25_hires.png'
      }
    },
    'swsh4-19': {
      id: 'swsh4-19',
      name: 'Charizard VMAX',
      supertype: 'Pokémon',
      subtypes: ['Evolution', 'VMAX'],
      hp: '330',
      types: ['Fire'],
      attacks: [{
        name: 'G-Max Wildfire',
        cost: ['Fire', 'Fire', 'Fire', 'Colorless'],
        convertedEnergyCost: 4,
        damage: '300',
        text: 'Discard 2 Energy attached to this Pokémon.'
      }],
      set: {
        name: 'Vivid Voltage',
        series: 'Sword & Shield',
        releaseDate: '2020-11-13',
        images: {
          symbol: 'https://images.pokemontcg.io/swsh4/symbol.png',
          logo: 'https://images.pokemontcg.io/swsh4/logo.png'
        }
      },
      number: '19',
      artist: '5ban Graphics',
      rarity: 'Rare Rainbow',
      images: {
        small: 'https://images.pokemontcg.io/swsh4/19.png',
        large: 'https://images.pokemontcg.io/swsh4/19_hires.png'
      }
    }
  };
  
  constructor(private http: HttpClient) {}

  async searchCards(name: string) {
    const url = `${this.baseUrl}/cards`;
    const params = {
      q: `name:${name}*`,
      orderBy: '-set.releaseDate' // El guión indica orden descendente
    };
    
    const headers = new HttpHeaders({
      'X-Api-Key': this.apiKey
    });

    try {
      const response = await firstValueFrom(
        this.http.get<PokemonCardResponse>(url, { params, headers })
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching cards:', error);
      throw error;
    }
  }

  async getCard(id: string): Promise<PokemonCard> {
    // Durante el pre-rendering, usar datos mock
    if (typeof window === 'undefined' && this.mockCards[id]) {
      return this.mockCards[id];
    }

    const url = `${this.baseUrl}/cards/${id}`;
    const headers = new HttpHeaders({
      'X-Api-Key': this.apiKey
    });

    try {
      const response = await firstValueFrom(
        this.http.get<{ data: PokemonCard }>(url, { headers })
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching card:', error);
      throw error;
    }
  }
}
