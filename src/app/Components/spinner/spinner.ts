import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="floating-activity-indicator">
      <div class="activity-pulse"></div>
      <div class="activity-content">
        <div class="activity-spinner"></div>
        <span class="activity-text">{{ message }}</span>
      </div>
    </div>
  `,
  styleUrls: ['./spinner.scss']
})
export class SpinnerComponent implements OnInit {
  @Input() message: string = 'Procesando...';

  ngOnInit() {
    // Mensaje por defecto si no se proporciona uno
    if (!this.message) {
      this.message = 'Procesando...';
    }
  }
}
