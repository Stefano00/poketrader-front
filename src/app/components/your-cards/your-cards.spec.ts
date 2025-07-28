import { ComponentFixture, TestBed } from '@angular/core/testing';

import { YourCards } from './your-cards';

describe('YourCards', () => {
  let component: YourCards;
  let fixture: ComponentFixture<YourCards>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YourCards]
    })
    .compileComponents();

    fixture = TestBed.createComponent(YourCards);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
