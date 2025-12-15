import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="spinner-overlay">
      <div class="spinner-content">
        <div class="spinner-container">
          <div class="spinner">
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
            <div class="spinner-ring"></div>
          </div>
        </div>
        <p class="spinner-text">Procesando...</p>
      </div>
    </div>
  `,
  styleUrls: ['./spinner.scss']
})
export class SpinnerComponent {}
