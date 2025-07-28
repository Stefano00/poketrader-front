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
