import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OfficeComponent } from './office';

describe('OfficeComponent', () => {
  let component: OfficeComponent;
  let fixture: ComponentFixture<OfficeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfficeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OfficeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should update preview name when displayName changes', () => {
    component.displayName = 'Equipo Beta';
    expect(component.previewName).toBe('Equipo Beta');
  });

  it('should not send empty messages', () => {
    const initialMessages = component.messages.length;
    component.messageText = '   ';
    component.sendMessage();
    expect(component.messages.length).toBe(initialMessages);
  });

  it('should add message when sendMessage is called', () => {
    component.displayName = 'Beta';
    component.messageText = 'Probando canal';
    const initialMessages = component.messages.length;
    component.sendMessage();
    expect(component.messages.length).toBe(initialMessages + 1);
    expect(component.messages.at(-1)?.content).toBe('Probando canal');
  });
});
