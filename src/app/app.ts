import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeToggleComponent } from './Components/theme-toggle/theme-toggle';
import { ToastHostComponent } from './Components/toast-host/toast-host';
import { ConfirmHostComponent } from './Components/confirm-host/confirm-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ThemeToggleComponent, ToastHostComponent, ConfirmHostComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected title = 'launcher';
}
