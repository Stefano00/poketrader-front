import { RenderMode, ServerRoute } from '@angular/ssr';
import { TcgplayerService } from './services/tcgplayer';
import { firstValueFrom } from 'rxjs';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'cards/:id',
    renderMode: RenderMode.Prerender,
    async getPrerenderParams() {
      // Durante el build, pre-renderizaremos algunas cartas populares
      // Puedes ajustar esta lista según tus necesidades
      return [
        { id: 'swsh4-25' },  // Pikachu V
        { id: 'swsh4-19' },  // Charizard VMAX
        { id: 'base1-4' },   // Charizard Base Set
        { id: 'base1-2' },   // Blastoise Base Set
        { id: 'base1-15' },  // Venusaur Base Set
      ];
    }
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
