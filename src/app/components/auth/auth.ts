import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth.html',
  styleUrls: ['./auth.scss']
})
export class Auth {
  email = '';
  password = '';
  loading = false;
  message: string | null = null;

  constructor(private authService: AuthService) {}

  async submit(form: NgForm) {
    if (form.invalid) return;
    this.loading = true;
    this.message = null;
    const res = await this.authService.login(this.email, this.password);
    this.loading = false;
    this.message = res.message;
  }
}
