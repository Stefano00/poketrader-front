import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TcgplayerService } from './tcgplayer';

describe('TcgplayerService', () => {
  let service: TcgplayerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule]
    });
    service = TestBed.inject(TcgplayerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
