import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TcgplayerService } from '../../services/tcgplayer';
import { PokemonCard } from '../../services/tcgplayer';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './card.html',
  styleUrl: './card.scss'
})
export class Card implements OnInit {
  loading = true;
  card?: PokemonCard;
  error?: string;

  constructor(
    private route: ActivatedRoute,
    private tcgService: TcgplayerService
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadCard(id);
    }
  }

  private async loadCard(id: string) {
    try {
      this.loading = true;
      this.card = await this.tcgService.getCard(id);
    } catch (error) {
      console.error('Error loading card:', error);
      this.error = 'Failed to load card details';
    } finally {
      this.loading = false;
    }
  }

  formatPrice(price: number | undefined): string {
    return price ? price.toFixed(2) : '0.00';
  }

  getHolofoilPrice(type: 'market' | 'low' | 'mid' | 'high'): string {
    return this.formatPrice(this.card?.tcgplayer?.prices?.holofoil?.[type]);
  }

  getNormalPrice(type: 'market' | 'low' | 'mid' | 'high'): string {
    return this.formatPrice(this.card?.tcgplayer?.prices?.normal?.[type]);
  }

  getReverseHolofoilPrice(type: 'market' | 'low' | 'mid' | 'high'): string {
    return this.formatPrice(this.card?.tcgplayer?.prices?.reverseHolofoil?.[type]);
  }
}
