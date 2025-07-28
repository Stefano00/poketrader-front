import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TcgplayerService } from '../../services/tcgplayer';
import { CommonModule } from '@angular/common';

import { PokemonCard } from '../../services/tcgplayer';

@Component({
  selector: 'app-cards',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './cards.html',
  styleUrl: './cards.scss'
})

export class Cards {
  loading = false;
  cards: PokemonCard[] = [];

  searchForm = new FormGroup({
    cardName: new FormControl(''),
  });

  constructor(private tcgService: TcgplayerService) {}

  getMarketPrice(card: PokemonCard): string {
    const price = card.tcgplayer?.prices?.holofoil?.market || 
                 card.tcgplayer?.prices?.normal?.market || 
                 card.tcgplayer?.prices?.reverseHolofoil?.market;
    return price ? price.toFixed(2) : '0.00';
  }

  async searchCards() {
    if (this.searchForm.valid) {
      this.loading = true;
      try {
        const name = this.searchForm.get('cardName')?.value;
        if (name) {
          const cards = await this.tcgService.searchCards(name);
          
          // Ordenar las cartas por fecha de lanzamiento, las más recientes primero
          this.cards = cards.sort((a, b) => {
            if (!a.set.releaseDate || !b.set.releaseDate) {
              return 0; // Si no hay fecha, mantener el orden original
            }
            
            // Convertir las fechas a formato ISO para asegurar consistencia
            const dateA = new Date(a.set.releaseDate + 'T00:00:00Z');
            const dateB = new Date(b.set.releaseDate + 'T00:00:00Z');
            
            console.log(`Comparing dates: ${a.set.name} (${a.set.releaseDate}) vs ${b.set.name} (${b.set.releaseDate})`);
            
            // Validar que las fechas sean válidas
            if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
              console.error('Invalid date detected:', { 
                cardA: { name: a.set.name, date: a.set.releaseDate },
                cardB: { name: b.set.name, date: b.set.releaseDate }
              });
              return 0;
            }
            
            return dateB.getTime() - dateA.getTime(); // orden descendente (más reciente primero)
          });
        }
      } catch (error) {
        console.error('Error searching cards:', error);
      } finally {
        this.loading = false;
      }
    }
  }
}
