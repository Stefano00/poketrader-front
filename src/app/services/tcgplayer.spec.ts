import { TestBed } from '@angular/core/testing';

import { Tcgplayer } from './tcgplayer';

describe('Tcgplayer', () => {
  let service: Tcgplayer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Tcgplayer);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
