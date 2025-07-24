import { Component, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { gsap } from 'gsap';
import packageJson from '../../../../package.json';

@Component({
  selector: 'app-home',
  templateUrl: './home.html',
  styleUrl: './home.scss',
  standalone: true,
})
export class Home implements AfterViewInit {
  version = packageJson.version;

  constructor(private router: Router) {}

  ngAfterViewInit(): void {
    const tl = gsap.timeline();

    tl.from('#logo', {
      scale: 0,
      opacity: 0,
      duration: 1,
      ease: 'back.out(1.7)',
    })
      .from('#title h2', {
        y: -50,
        opacity: 0,
        duration: 1,
        ease: 'power2.out',
      })
      .from(
        '#title p',
        {
          opacity: 0,
          y: 20,
          duration: 0.6,
        },
        '-=0.5'
      )
      .from('#buttons button', {
        opacity: 0,
        y: 30,
        stagger: 0.2,
        duration: 0.8,
        ease: 'back.out(1.7)',
      });
  }

  goToConfig() {
    this.router.navigate(['/config']);
  }

  goToLauncher() {
    this.router.navigate(['/launcher']);
  }
}
