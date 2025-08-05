import { Routes } from '@angular/router';
import { ConfigComponent } from './Pages/config/config';
import { Launcher } from './Pages/launcher/launcher';
import { Home } from './Pages/home/home';
import { UsersComponent } from './Pages/users/users';

export const routes: Routes = [
  { path: '', component: Home },
  { path: 'config', component: ConfigComponent },
  { path: 'launcher', component: Launcher },
  { path: 'users', component: UsersComponent },
  { path: '**', redirectTo: '' },
];
