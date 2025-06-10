import { Routes } from '@angular/router';
import { ConfigComponent } from './Pages/config/config';
import { Launcher } from './Pages/launcher/launcher';

export const routes: Routes = [
  { path: '', component: ConfigComponent },
  { path: 'launcher', component: Launcher },
   { path: '**', redirectTo: '' }
];
