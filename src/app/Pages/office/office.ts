import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type AvatarTone = 'sky' | 'sunset' | 'forest' | 'amethyst' | 'ocean' | 'ember';

interface AvatarOption {
  id: string;
  label: string;
  emoji: string;
  description: string;
  tone: AvatarTone;
}

interface ChatMessage {
  id: number;
  author: string;
  avatar: AvatarOption;
  content: string;
  createdAt: Date;
  isSystem?: boolean;
}

@Component({
  selector: 'app-office',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './office.html',
  styleUrls: ['./office.scss'],
})
export class OfficeComponent {
  @ViewChild('messageList') private messageList?: ElementRef<HTMLDivElement>;

  displayName = '';
  messageText = '';

  readonly avatars: AvatarOption[] = [
    {
      id: 'pilot',
      label: 'Piloto Espacial',
      emoji: '🧑‍🚀',
      description: 'Explorador intergaláctico listo para despegar.',
      tone: 'sky',
    },
    {
      id: 'engineer',
      label: 'Ingeniera DevOps',
      emoji: '🧑‍💻',
      description: 'Mantiene los microservicios en órbita estable.',
      tone: 'amethyst',
    },
    {
      id: 'botanist',
      label: 'Botánica de Terraformación',
      emoji: '🧑‍🔬',
      description: 'Hace florecer los entornos más hostiles.',
      tone: 'forest',
    },
    {
      id: 'captain',
      label: 'Capitana de la Flota',
      emoji: '🧑‍✈️',
      description: 'Coordina a la tripulación con precisión milimétrica.',
      tone: 'sunset',
    },
    {
      id: 'navigator',
      label: 'Navegante Galáctico',
      emoji: '🧭',
      description: 'Encuentra rutas óptimas entre servicios.',
      tone: 'ocean',
    },
    {
      id: 'guardian',
      label: 'Guardián de Seguridad',
      emoji: '🛡️',
      description: 'Asegura que todo el equipo esté protegido.',
      tone: 'ember',
    },
  ];

  selectedAvatar: AvatarOption = this.avatars[0];

  messages: ChatMessage[] = [
    {
      id: Date.now(),
      author: 'Sistema',
      avatar: this.avatars[0],
      content:
        'Bienvenido a la oficina virtual. Elige un avatar, ponle nombre y cuéntale al equipo en qué estás trabajando.',
      createdAt: new Date(),
      isSystem: true,
    },
  ];

  get previewName(): string {
    return this.displayName.trim() || 'Invitado';
  }

  selectAvatar(avatar: AvatarOption): void {
    this.selectedAvatar = avatar;
  }

  sendMessage(): void {
    const content = this.messageText.trim();

    if (!content) {
      return;
    }

    const author = this.previewName;

    const message: ChatMessage = {
      id: Date.now(),
      author,
      avatar: this.selectedAvatar,
      content,
      createdAt: new Date(),
    };

    this.messages = [...this.messages, message];
    this.messageText = '';
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    if (!this.messageList) {
      return;
    }

    requestAnimationFrame(() => {
      const el = this.messageList?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  trackByMessageId(_: number, message: ChatMessage): number {
    return message.id;
  }
}
