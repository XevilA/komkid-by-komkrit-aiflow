import React, { useState } from 'react';
import { Lock, User, Eye, EyeOff, ArrowLeft, ShieldCheck, Crown } from 'lucide-react';
import { api } from '../api';

interface Props {
  onLoginSuccess: (username: string) => void;
  onBackToPublic: () => void;
}

export const AdminLoginScreen: React.FC<Props> = ({
  onLoginSuccess,
  onBackToPublic,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.loginAdmin(username.trim(), password);
      onLoginSuccess(res.username);
    } catch (err) {
      setError((err as Error).message || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-[410px]">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/85 overflow-hidden">
          <div className="bg-gradient-to-b from-[#0a101d] to-[#121e36] px-7 py-7 text-center text-white">
            <img
              src="/images/avatar-komkrit.png"
              alt="คมคิด by KOMKRIT"
              className="h-14 w-14 mx-auto rounded-full object-cover ring-1 ring-amber-300/70 shadow-sm"
            />
            <div className="mt-3 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-amber-300">
              <Crown className="w-3 h-3" />
              KOMKID EXECUTIVE STUDIO
            </div>
            <h1 className="mt-1 text-lg font-bold tracking-tight">
              เข้าสู่ศูนย์บริหารจัดการ AI Co-work
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              คมคิด by KOMKRIT • คิดต่างอย่างสร้างสรรค์
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-7 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                ชื่อผู้ใช้งาน (Username)
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="กรอกชื่อผู้ใช้งาน"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-[#0a101d] focus:bg-white focus:outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                รหัสผ่าน (Password)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่าน"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-10 py-2.5 text-sm text-slate-900 focus:border-[#0a101d] focus:bg-white focus:outline-none transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  aria-label="แสดงหรือซ่อนรหัสผ่าน"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0a101d] py-3 text-sm font-semibold text-amber-300 hover:bg-slate-800 transition cursor-pointer disabled:opacity-60"
            >
              <ShieldCheck className="w-4 h-4" />
              {loading ? 'กำลังตรวจสอบสิทธิ์...' : 'เข้าสู่ระบบผู้บริหาร'}
            </button>
          </form>
        </div>

        <div className="mt-5 text-center">
          <button
            onClick={onBackToPublic}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 transition cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            กลับสู่หน้าเว็บไซต์หลัก
          </button>
        </div>
      </div>
    </div>
  );
};
