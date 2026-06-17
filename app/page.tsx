"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, User } from 'firebase/auth';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import {
    Mail, Lock, LogIn, Plane, PlusCircle, ChevronLeft, Settings,
    Receipt, Wallet, ArrowRightLeft, Trash2, Globe, CheckCircle2, AlertCircle, LogOut, Edit3, X, Plus, Calendar, Filter
} from 'lucide-react';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ============================================================================
// Firebase 초기화 로직 (단일 파일 환경인 Canvas 컴파일을 위해 내부에 배치)
// ============================================================================
let firebaseConfig = {
    apiKey: "demo",
    authDomain: "demo",
    projectId: "demo-project",
    storageBucket: "demo",
    messagingSenderId: "demo",
    appId: "demo"
};

if (typeof process !== 'undefined' && process.env) {
    firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo",
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo",
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-project",
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "demo",
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "demo",
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "demo"
    };
}

if (typeof __firebase_config !== 'undefined') {
    firebaseConfig = JSON.parse(__firebase_config);
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 권한 문제 해결을 위해 환경에 맞는 앱 고유 ID를 설정합니다.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'enter-split-app';

// ============================================================================
// [중요] 미리보기(Canvas) 환경과 로컬 프로덕션 환경의 데이터 경로를 매끄럽게 호환해 줍니다.
// ============================================================================
const getTripsCollection = (uid: string) => {
    if (typeof __firebase_config !== 'undefined') {
        return collection(db, 'artifacts', appId, 'users', uid, 'trips');
    }
    return collection(db, 'trips');
};

const getExpensesCollection = (uid: string) => {
    if (typeof __firebase_config !== 'undefined') {
        return collection(db, 'artifacts', appId, 'users', uid, 'expenses');
    }
    return collection(db, 'expenses');
};

const getTripDoc = (uid: string, tripId: string) => {
    if (typeof __firebase_config !== 'undefined') {
        return doc(db, 'artifacts', appId, 'users', uid, 'trips', tripId);
    }
    return doc(db, 'trips', tripId);
};

const getExpenseDoc = (uid: string, expenseId: string) => {
    if (typeof __firebase_config !== 'undefined') {
        return doc(db, 'artifacts', appId, 'users', uid, 'expenses', expenseId);
    }
    return doc(db, 'expenses', expenseId);
};

// ============================================================================
// [1] TypeScript 데이터 타입 정의
// ============================================================================
interface Trip {
    id: string;
    userId: string;
    title: string;
    currency: string;
    baseExchangeRate: number;
    createdAt: number;
    startDate?: string;
    endDate?: string;
}

interface Expense {
    id: string;
    tripId: string;
    payer: string;
    participants: string[];
    originalAmount: number;
    appliedRate: number;
    calculatedKrw: number;
    description: string;
    createdAt: number;
}

interface SmartInputResult {
    payer: string;
    participants: string[];
    originalAmount: number;
    appliedRate: number;
    calculatedKrw: number;
    description: string;
    isKrwInput: boolean;
}

// ============================================================================
// [2] 스마트 파싱 마법 엔진 (원화 탐지 감지 로직 고도화)
// ============================================================================
const parseSmartInput = (text: string, baseRate: number): SmartInputResult | null => {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 3) return null;

    try {
        const nameLine = lines[0];
        const members = nameLine.includes(' ') ? nameLine.split(' ') : nameLine.match(/.{1,2}/g) || [];
        const payer = members[0];

        let amountLine = lines[1].toLowerCase();

        // 원화(KRW) 결제인지 텍스트 단에서 미리 검증
        const isKrwInput = amountLine.includes('원') || amountLine.includes('krw') || amountLine.includes('₩');
        let customRate = isKrwInput ? 1 : baseRate;

        if (amountLine.includes('@')) {
            const parts = amountLine.split('@');
            amountLine = parts[0];
            customRate = parseFloat(parts[1].replace(/[^0-9.]/g, '')) || (isKrwInput ? 1 : baseRate);
        }

        const koreanNumbers: Record<string, number> = { '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9 };
        const parsedStr = amountLine.replace(/[일이삼사오육칠팔구]/g, (m) => String(koreanNumbers[m]));
        let baseNum = parseInt(parsedStr.replace(/[^0-9]/g, '')) || 0;

        if (parsedStr.includes('만')) baseNum *= 10000;
        else if (parsedStr.includes('천')) baseNum *= 1000;
        else if (parsedStr.includes('백')) baseNum *= 100;

        const description = lines[2];

        return {
            payer,
            participants: members,
            originalAmount: baseNum,
            appliedRate: customRate,
            calculatedKrw: Math.round(baseNum * customRate),
            description,
            isKrwInput
        };
    } catch (e) {
        return null;
    }
};

// ============================================================================
// [3] 메인 애플리케이션 (SaaS 구조 모델)
// ============================================================================
export default function App() {
    const [user, setUser] = useState<User | null>(null);
    const [activeView, setActiveView] = useState<'login' | 'dashboard' | 'tripDetail'>('login');

    const [trips, setTrips] = useState<Trip[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [currentTripId, setCurrentTripId] = useState<string | null>(null);

    const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
    const [tripFilter, setTripFilter] = useState<'all' | 'upcoming' | 'past'>('all');

    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    // 이메일 로그인 상태 감지
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    try {
                        await signInAnonymously(auth);
                    } catch (anonErr: any) {
                        console.warn("익명 인증 비활성화 상태입니다. 이메일 로그인을 이용하세요.", anonErr.message);
                    }
                }
            } catch (err) {
                console.error("인증 시스템 초기화 실패:", err);
            }
        };
        initAuth();

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (currentUser) setActiveView('dashboard');
            else setActiveView('login');
        });
        return () => unsubscribe();
    }, []);

    // 여행지 필터값 로컬스토리지 불러오기 (새로고침 유지)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('enter_trip_filter');
            if (saved === 'all' || saved === 'upcoming' || saved === 'past') {
                setTripFilter(saved);
            }
        }
    }, []);

    const handleFilterChange = (filter: 'all' | 'upcoming' | 'past') => {
        setTripFilter(filter);
        if (typeof window !== 'undefined') {
            localStorage.setItem('enter_trip_filter', filter);
        }
    };

    // 이메일/비밀번호 로그인 처리
    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;

        try {
            await signInWithEmailAndPassword(auth, email, password);
            showToast('성공적으로 로그인되었습니다!');
        } catch (err: any) {
            showToast('로그인에 실패했습니다. 계정 정보를 확인해주세요.', 'error');
            console.error(err);
        }
    };

    // 로그아웃 처리
    const handleSignOut = async () => {
        try {
            await auth.signOut();
            showToast('로그아웃 되었습니다.');
        } catch (err) {
            showToast('로그아웃 중 오류가 발생했습니다.', 'error');
        }
    };

    // Firestore 실시간 데이터 스트리밍 연동
    useEffect(() => {
        if (!user) return;

        const tripsCol = getTripsCollection(user.uid);
        const tripsQuery = typeof __firebase_config !== 'undefined'
            ? tripsCol
            : query(tripsCol, where('userId', '==', user.uid));

        const unsubTrips = onSnapshot(tripsQuery, (snap) => {
            const tripData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trip));
            tripData.sort((a, b) => b.createdAt - a.createdAt);
            setTrips(tripData);
        }, (err) => {
            console.error("여행지 로드 실패:", err);
            showToast("여행지 데이터를 불러오는데 실패했습니다.", "error");
        });

        const expensesCol = getExpensesCollection(user.uid);
        const unsubExpenses = onSnapshot(expensesCol, (snap) => {
            const expData = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
            expData.sort((a, b) => b.createdAt - a.createdAt);
            setExpenses(expData);
        }, (err) => {
            console.error("지출 내역 로드 실패:", err);
            showToast("지출 내역 데이터를 불러오는데 실패했습니다.", "error");
        });

        return () => {
            unsubTrips();
            unsubExpenses();
        };
    }, [user]);

    const currentTrip = useMemo(() => {
        if (!currentTripId) return null;
        return trips.find(t => t.id === currentTripId) || null;
    }, [trips, currentTripId]);

    const currentExpenses = useMemo(() => {
        if (!currentTrip) return [];
        return expenses.filter(exp => exp.tripId === currentTrip.id);
    }, [expenses, currentTrip]);

    const filteredTrips = useMemo(() => {
        if (tripFilter === 'all') return trips;
        // 오늘 날짜 KST 기준 YYYY-MM-DD
        const today = new Date().toLocaleDateString('sv-SE').split(' ')[0];

        return trips.filter(trip => {
            if (tripFilter === 'upcoming') {
                // 종료일이 없거나, 오늘보다 미래(또는 오늘)인 경우 진행중으로 판단
                return !trip.endDate || trip.endDate >= today;
            }
            if (tripFilter === 'past') {
                // 종료일이 과거인 경우
                return trip.endDate && trip.endDate < today;
            }
            return true;
        });
    }, [trips, tripFilter]);

    if (activeView === 'dashboard') {
        const handleCreateTrip = async (e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            if (!user) return;

            const formData = new FormData(e.currentTarget);
            const title = formData.get('title') as string;
            const currency = formData.get('currency') as string;
            const baseRate = parseFloat(formData.get('baseRate') as string);
            const startDate = formData.get('startDate') as string;
            const endDate = formData.get('endDate') as string;

            try {
                await addDoc(getTripsCollection(user.uid), {
                    userId: user.uid,
                    title,
                    currency,
                    baseExchangeRate: baseRate,
                    startDate,
                    endDate,
                    createdAt: Date.now()
                });
                showToast('✅ 여행지가 성공적으로 생성되었습니다!');
                (e.target as HTMLFormElement).reset();
            } catch (error: any) {
                showToast(`❌ 생성에 실패했습니다: ${error.message}`, 'error');
                console.error("여행지 생성 오류:", error);
            }
        };

        return (
            <div className="min-h-screen bg-slate-50 p-4 md:p-8 relative">
                {toast && (
                    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 p-4 rounded-xl shadow-lg flex items-center gap-2 border animate-in slide-in-from-top-4 duration-300 ${
                        toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}>
                        {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                        <span className="text-sm font-semibold">{toast.message}</span>
                    </div>
                )}

                <div className="max-w-2xl mx-auto">
                    <header className="flex items-center justify-between mb-8">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                                <Globe className="text-indigo-600" /> 나의 정산 프로젝트
                            </h1>
                            {user && (
                                <p className="text-xs text-slate-500 mt-1 font-medium bg-slate-100 py-1 px-2.5 rounded-lg inline-block">
                                    계정: {user.email || user.uid}
                                </p>
                            )}
                        </div>
                        <button
                            onClick={handleSignOut}
                            className="flex items-center gap-1.5 text-xs bg-white text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-100 px-3 py-2 rounded-xl transition-all shadow-sm font-bold"
                        >
                            <LogOut size={14} /> 로그아웃
                        </button>
                    </header>

                    <form onSubmit={handleCreateTrip} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-8 space-y-4">
                        <div className="flex flex-col md:flex-row gap-4">
                            <div className="flex-1">
                                <label className="block text-sm font-semibold text-slate-700 mb-1">프로젝트(여행지) 이름</label>
                                <input name="title" required placeholder="예) 오사카 먹방여행" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                            <div className="w-full md:w-32">
                                <label className="block text-sm font-semibold text-slate-700 mb-1">사용 통화</label>
                                <input name="currency" required placeholder="예) JPY" defaultValue="KRW" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                            <div className="w-full md:w-32">
                                <label className="block text-sm font-semibold text-slate-700 mb-1">기준 환율 (원)</label>
                                <input name="baseRate" required type="number" step="0.01" placeholder="예) 9.0" defaultValue="1" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                        </div>
                        <div className="flex flex-col md:flex-row gap-4 items-end">
                            <div className="w-full md:w-1/3">
                                <label className="block text-sm font-semibold text-slate-700 mb-1">시작일 (선택)</label>
                                <input name="startDate" type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-600" />
                            </div>
                            <div className="w-full md:w-1/3">
                                <label className="block text-sm font-semibold text-slate-700 mb-1">종료일 (선택)</label>
                                <input name="endDate" type="date" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-600" />
                            </div>
                            <button type="submit" className="w-full md:w-1/3 bg-slate-900 text-white font-bold px-6 py-3 rounded-xl hover:bg-slate-800 transition-colors h-[50px]">
                                생성하기
                            </button>
                        </div>
                    </form>

                    <div className="flex justify-between items-center mb-4 px-1">
                        <h2 className="font-bold text-slate-700 flex items-center gap-2">
                            <Filter size={18} /> 내 여행 목록
                        </h2>
                        <div className="flex bg-slate-100 p-1 rounded-xl shadow-inner">
                            <button type="button" onClick={() => handleFilterChange('all')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${tripFilter === 'all' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>전체</button>
                            <button type="button" onClick={() => handleFilterChange('upcoming')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${tripFilter === 'upcoming' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>예정/진행</button>
                            <button type="button" onClick={() => handleFilterChange('past')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${tripFilter === 'past' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}>지난 여행</button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-10">
                        {filteredTrips.length === 0 ? (
                            <div className="col-span-1 md:col-span-2 text-center py-12 bg-white rounded-2xl border border-slate-200 border-dashed text-slate-500">
                                조건에 맞는 여행지가 없습니다.
                            </div>
                        ) : filteredTrips.map(trip => {
                            const tripExps = expenses.filter(e => e.tripId === trip.id);
                            const totalKrw = tripExps.reduce((sum, e) => sum + e.calculatedKrw, 0);

                            return (
                                <div key={trip.id} onClick={() => { setCurrentTripId(trip.id); setActiveView('tripDetail'); }}
                                     className="group relative bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-500 hover:shadow-md transition-all text-left flex flex-col cursor-pointer">

                                    <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button type="button" onClick={(e) => { e.stopPropagation(); setEditingTrip(trip); }} className="p-1.5 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors border"><Edit3 size={15} /></button>
                                    </div>

                                    <div className="flex items-center gap-2 mb-1 pr-10">
                                        <Plane className="text-indigo-500 w-5 h-5 flex-shrink-0" />
                                        <h3 className="font-bold text-lg text-slate-800 truncate">{trip.title}</h3>
                                    </div>

                                    {(trip.startDate || trip.endDate) && (
                                        <p className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5 mb-2">
                                            <Calendar size={12} /> {trip.startDate ? trip.startDate.replace(/-/g, '.') : '?'} ~ {trip.endDate ? trip.endDate.replace(/-/g, '.') : '?'}
                                        </p>
                                    )}

                                    <div className="mt-auto pt-4 border-t border-slate-100 flex justify-between items-center w-full">
                                        <span className="text-sm text-slate-500">환율: {trip.currency} {trip.baseExchangeRate}원</span>
                                        <span className="font-extrabold text-indigo-600">총 {totalKrw.toLocaleString()}원</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 대시보드 내 여행지 수정/삭제 모달 마운트 */}
                {editingTrip && (
                    <TripEditModal
                        trip={editingTrip}
                        expenses={expenses}
                        onClose={() => setEditingTrip(null)}
                        user={user}
                        showToast={showToast}
                    />
                )}
            </div>
        );
    }

    if (!user || activeView === 'login') {
        return (
            <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 relative">
                {toast && (
                    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 p-4 rounded-xl shadow-lg flex items-center gap-2 border animate-in slide-in-from-top-4 duration-300 ${
                        toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}>
                        {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                        <span className="text-sm font-semibold">{toast.message}</span>
                    </div>
                )}

                <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
                    <div className="text-center mb-8">
                        <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                            <ArrowRightLeft className="text-indigo-600 w-8 h-8" />
                        </div>
                        <h1 className="text-2xl font-bold text-slate-800">엔터정산</h1>
                        <p className="text-slate-500 text-sm mt-2">단 한 번의 입력으로 끝내는 N:1 관리</p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">이메일</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                                <input name="email" type="email" required placeholder="admin@example.com" className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">비밀번호</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
                                <input name="password" type="password" required placeholder="••••••••" className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                            </div>
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 mt-6">
                            <LogIn width={20} /> 시작하기
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    return (
        <TripDetailApp
            trip={currentTrip!}
            expenses={currentExpenses}
            onBack={() => { setCurrentTripId(null); setActiveView('dashboard'); }}
            user={user}
            showToast={showToast}
            toast={toast}
        />
    );
}

// ----------------------------------------------------------------------------
// [서브 컴포넌트] 여행지 상세 가계부 화면
// ----------------------------------------------------------------------------
function TripDetailApp({
                           trip, expenses, onBack, user, showToast, toast
                       }: {
    trip: Trip, expenses: Expense[], onBack: () => void, user: User,
    showToast: (m: string, t?: 'success'|'error') => void, toast: { message: string; type: 'success' | 'error' } | null
}) {
    const [activeTab, setActiveTab] = useState<'input'|'list'|'settlement'>('input');
    const [smartText, setSmartText] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

    const parsedPreview = useMemo(() => parseSmartInput(smartText, trip.baseExchangeRate), [smartText, trip.baseExchangeRate]);

    // 해당 여행지에 등록된 모든 참석자 후보군 도출 (정밀 인물 편집을 위함)
    const allMembers = useMemo(() => {
        const membersSet = new Set<string>();
        expenses.forEach(exp => {
            membersSet.add(exp.payer);
            exp.participants.forEach(p => membersSet.add(p));
        });
        if (membersSet.size === 0) {
            membersSet.add('나');
        }
        return Array.from(membersSet);
    }, [expenses]);

    const handleSmartSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!parsedPreview) return showToast('입력 형식을 확인해 주세요.', 'error');

        try {
            await addDoc(getExpensesCollection(user.uid), {
                tripId: trip.id,
                ...parsedPreview,
                createdAt: Date.now()
            });

            setSmartText('');
            showToast('✅ 지출내역이 성공적으로 저장되었습니다!');
            setActiveTab('list');
        } catch (error: any) {
            showToast(`❌ 저장 실패: ${error.message}`, 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('내역을 삭제하시겠습니까?')) {
            try {
                await deleteDoc(getExpenseDoc(user.uid, id));
                showToast('✅ 지출내역이 삭제되었습니다.');
            } catch (error: any) {
                showToast(`❌ 삭제 실패: ${error.message}`, 'error');
            }
        }
    };

    const settlements = useMemo(() => {
        const balances: Record<string, number> = {};
        expenses.forEach(exp => {
            balances[exp.payer] = (balances[exp.payer] || 0) + exp.calculatedKrw;
            const splitAmount = exp.calculatedKrw / exp.participants.length;
            exp.participants.forEach(p => {
                balances[p] = (balances[p] || 0) - splitAmount;
            });
        });
        return balances;
    }, [expenses]);

    return (
        <div className="min-h-screen bg-slate-50 flex justify-center text-slate-800 w-full relative">
            {toast && (
                <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 p-4 rounded-xl shadow-lg flex items-center gap-2 border animate-in slide-in-from-top-4 duration-300 ${
                    toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}>
                    {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                    <span className="text-sm font-semibold">{toast.message}</span>
                </div>
            )}

            <div className="w-full max-w-md bg-white shadow-xl relative flex flex-col min-h-screen pb-20">
                <header className="bg-indigo-600 text-white p-4 flex items-center justify-between z-10 shadow-md">
                    <button onClick={onBack} className="p-2 hover:bg-indigo-700 rounded-full"><ChevronLeft /></button>
                    <div className="text-center">
                        <h1 className="text-lg font-bold">{trip.title}</h1>
                        <p className="text-xs text-indigo-200">{trip.currency} 기준 (환율: {trip.baseExchangeRate})</p>
                    </div>
                    <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-indigo-700 rounded-full"><Settings width={20}/></button>
                </header>

                {showSettings && <SettingsModal trip={trip} expenses={expenses} onClose={() => setShowSettings(false)} user={user} showToast={showToast} />}

                {/* 지출내역 상세 편집 모달 */}
                {editingExpense && (
                    <ExpenseEditModal
                        trip={trip}
                        expense={editingExpense}
                        onClose={() => setEditingExpense(null)}
                        user={user}
                        showToast={showToast}
                        allMembers={allMembers}
                    />
                )}

                <main className="flex-1 p-5 overflow-y-auto bg-slate-50">
                    {activeTab === 'input' && (
                        <div className="animate-in fade-in duration-300">
                            <div className="mb-4 bg-indigo-50 border border-indigo-100 p-4 rounded-xl">
                                <h3 className="font-bold text-indigo-800 flex items-center gap-2 mb-2">✨ 마법 입력 가이드</h3>
                                <div className="bg-white p-2 rounded text-xs text-slate-600 font-mono leading-relaxed">
                                    철수영희민수<br/>
                                    5천엔 (또는 원화결제 시: <span className="font-bold text-emerald-600">5만원</span>)<br/>
                                    도톤보리 타코야끼
                                </div>
                            </div>

                            <form onSubmit={handleSmartSubmit} className="space-y-4">
                <textarea
                    className="w-full h-40 p-4 bg-white border border-slate-300 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-lg"
                    placeholder="여기에 입력하세요..."
                    value={smartText}
                    onChange={(e) => setSmartText(e.target.value)}
                    autoFocus
                />

                                {smartText.trim().length > 0 && (
                                    <div className={`p-4 rounded-xl border ${parsedPreview ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                                        {parsedPreview ? (
                                            <div>
                                                <div className="flex items-center gap-1 text-emerald-700 font-bold mb-2">
                                                    <CheckCircle2 width={16}/> 인식 완료
                                                </div>
                                                <ul className="text-sm space-y-1 text-slate-700">
                                                    <li>결제: <span className="font-bold text-indigo-600">{parsedPreview.payer}</span></li>
                                                    <li>참여: {parsedPreview.participants.join(', ')}</li>
                                                    <li>금액: {parsedPreview.originalAmount.toLocaleString()} {parsedPreview.appliedRate === 1 ? 'KRW' : trip.currency}</li>
                                                </ul>
                                                {parsedPreview.appliedRate === 1 ? (
                                                    <p className="text-[10px] text-emerald-600 font-bold mt-1">💡 원화(KRW) 결제 건으로 감지되어 환율을 곱하지 않고 직접 합산합니다.</p>
                                                ) : (
                                                    trip.currency !== 'KRW' && (
                                                        <p className="text-[10px] text-slate-500 mt-1">≈ {parsedPreview.calculatedKrw.toLocaleString()}원 (환율 {parsedPreview.appliedRate})</p>
                                                    )
                                                )}
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 text-red-600 font-medium text-sm">
                                                <AlertCircle width={16}/> 3줄로 명확히 입력해주세요.
                                            </div>
                                        )}
                                    </div>
                                )}
                                <button type="submit" disabled={!parsedPreview} className="w-full bg-slate-900 disabled:bg-slate-300 text-white font-bold py-4 rounded-xl shadow-md">
                                    입력 완료
                                </button>
                            </form>
                        </div>
                    )}

                    {activeTab === 'list' && (
                        <div className="space-y-3">
                            {expenses.length === 0 ? (
                                <div className="text-center text-slate-500 py-10">내역이 없습니다.</div>
                            ) : (
                                expenses.map(exp => (
                                    <div key={exp.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-start">
                                        <div className="flex-1 min-w-0 pr-2">
                      <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                        {exp.payer} 결제
                      </span>
                                            <p className="font-bold text-slate-800 mt-1.5 truncate">{exp.description}</p>
                                            <p className="text-xs text-slate-500 mt-1">참여: {exp.participants.join(', ')}</p>
                                        </div>
                                        <div className="text-right flex flex-col justify-between items-end h-full min-h-[75px]">
                                            <div>
                                                <p className="font-extrabold text-slate-800">{exp.calculatedKrw.toLocaleString()}원</p>
                                                {trip.currency !== 'KRW' && exp.appliedRate !== 1 && (
                                                    <p className="text-xs text-slate-400 mt-0.5">{exp.originalAmount.toLocaleString()} {trip.currency}</p>
                                                )}
                                                {trip.currency !== 'KRW' && exp.appliedRate === 1 && (
                                                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block">원화결제</span>
                                                )}
                                            </div>
                                            <div className="flex gap-1.5 mt-2">
                                                <button onClick={() => setEditingExpense(exp)} className="text-slate-300 hover:text-indigo-600 p-1 transition-colors">
                                                    <Edit3 size={15} />
                                                </button>
                                                <button onClick={() => handleDelete(exp.id)} className="text-slate-300 hover:text-red-500 p-1 transition-colors">
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === 'settlement' && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-2">
                            {Object.entries(settlements).map(([member, balance]) => (
                                <div key={member} className="flex items-center justify-between p-4 border-b border-slate-50 last:border-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-700">{member[0]}</div>
                                        <span className="font-bold text-slate-800">{member}</span>
                                    </div>
                                    <div className="text-right">
                                        {balance > 0 ? <span className="text-emerald-600 font-bold bg-emerald-50 px-3 py-1 rounded-full">+{Math.round(balance).toLocaleString()}원 받기</span>
                                            : balance < 0 ? <span className="text-rose-600 font-bold bg-rose-50 px-3 py-1 rounded-full">{Math.round(balance).toLocaleString()}원 보내기</span>
                                                : <span className="text-slate-400 font-medium">정산 완료</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </main>

                <nav className="absolute bottom-0 w-full bg-white border-t flex justify-around p-2 pb-6 z-10">
                    <button onClick={() => setActiveTab('input')} className={`p-2 ${activeTab === 'input' ? 'text-indigo-600' : 'text-slate-400'}`}><PlusCircle className="mx-auto"/><span className="text-xs">입력</span></button>
                    <button onClick={() => setActiveTab('list')} className={`p-2 ${activeTab === 'list' ? 'text-indigo-600' : 'text-slate-400'}`}><Receipt className="mx-auto"/><span className="text-xs">내역</span></button>
                    <button onClick={() => setActiveTab('settlement')} className={`p-2 ${activeTab === 'settlement' ? 'text-indigo-600' : 'text-slate-400'}`}><Wallet className="mx-auto"/><span className="text-xs">정산</span></button>
                </nav>
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------------
// [서브 컴포넌트] 환율 일괄 업데이트 모달
// ----------------------------------------------------------------------------
function SettingsModal({
                           trip, expenses, onClose, user, showToast
                       }: {
    trip: Trip, expenses: Expense[], onClose: () => void, user: User, showToast: (m: string, t?: 'success'|'error') => void
}) {
    const [newRate, setNewRate] = useState(trip.baseExchangeRate.toString());
    const [updateExisting, setUpdateExisting] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        const rateNum = parseFloat(newRate);

        try {
            await updateDoc(getTripDoc(user.uid, trip.id), { baseExchangeRate: rateNum });

            if (updateExisting) {
                for (const exp of expenses) {
                    await updateDoc(getExpenseDoc(user.uid, exp.id), {
                        appliedRate: rateNum,
                        calculatedKrw: Math.round(exp.originalAmount * rateNum)
                    });
                }
            }
            showToast('✅ 환율 설정이 성공적으로 저장되었습니다.');
            onClose();
        } catch (err: any) {
            showToast(`❌ 업데이트 실패: ${err.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm animate-in zoom-in-95 duration-200">
                <h2 className="text-xl font-bold mb-4">환율 설정</h2>
                <form onSubmit={handleUpdate} className="space-y-4">
                    <input type="number" step="0.01" value={newRate} onChange={e => setNewRate(e.target.value)} className="w-full p-3 bg-slate-50 border rounded-xl" />
                    <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer">
                        <input type="checkbox" checked={updateExisting} onChange={e => setUpdateExisting(e.target.checked)} className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500" />
                        <span className="text-sm">기존 내역도 일괄 재계산</span>
                    </label>
                    <div className="flex gap-2 pt-4">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 rounded-xl font-semibold">취소</button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-semibold">저장</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------------
// [서브 컴포넌트] 지출내역 전용 상세 편집 모달 (환율 우회 지원 및 정밀 UI 제공)
// ----------------------------------------------------------------------------
function ExpenseEditModal({
                              trip, expense, onClose, user, showToast, allMembers
                          }: {
    trip: Trip, expense: Expense, onClose: () => void, user: User,
    showToast: (m: string, t?: 'success'|'error') => void, allMembers: string[]
}) {
    const [description, setDescription] = useState(expense.description);
    const [localAmount, setLocalAmount] = useState(expense.originalAmount.toString());
    const [isKrw, setIsKrw] = useState(expense.appliedRate === 1);
    const [appliedRate, setAppliedRate] = useState(expense.appliedRate.toString());
    const [payer, setPayer] = useState(expense.payer);
    const [participants, setParticipants] = useState<string[]>(expense.participants);
    const [newMember, setNewMember] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // 새로운 임시 참여자를 목록에 추가
    const handleAddNewMember = () => {
        const trimmed = newMember.trim();
        if (!trimmed) return;
        if (allMembers.includes(trimmed) || participants.includes(trimmed)) {
            showToast('이미 존재하는 이름입니다.', 'error');
            return;
        }
        setParticipants([...participants, trimmed]);
        setNewMember('');
    };

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (participants.length === 0) {
            return showToast('최소 1명 이상의 참여자가 필요합니다.', 'error');
        }

        setIsLoading(true);
        const amtNum = parseFloat(localAmount) || 0;
        const rateNum = isKrw ? 1 : (parseFloat(appliedRate) || trip.baseExchangeRate);
        const calculatedKrw = Math.round(amtNum * rateNum);

        try {
            await updateDoc(getExpenseDoc(user.uid, expense.id), {
                description,
                originalAmount: amtNum,
                appliedRate: rateNum,
                calculatedKrw,
                payer,
                participants
            });
            showToast('✅ 지출내역이 성공적으로 수정되었습니다.');
            onClose();
        } catch (err: any) {
            showToast(`❌ 수정 실패: ${err.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200 shadow-xl space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                    <h2 className="text-lg font-bold text-slate-800">지출내역 수정</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                </div>

                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">사용처 (설명)</label>
                        <input required type="text" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">결제 금액 ({trip.currency})</label>
                        <input required type="number" value={localAmount} onChange={e => setLocalAmount(e.target.value)} className="w-full p-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-600" />
                    </div>

                    {/* 원화 전용 가계부가 아닐 때만 원화 결제 우회 옵션 제공 */}
                    {trip.currency !== 'KRW' && (
                        <>
                            <label className="flex items-center gap-2.5 p-3 bg-emerald-50 border border-emerald-100 rounded-xl cursor-pointer">
                                <input type="checkbox" checked={isKrw} onChange={e => setIsKrw(e.target.checked)} className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500" />
                                <span className="text-sm font-semibold text-emerald-800">원화(KRW)로 바로 결제함</span>
                            </label>

                            {!isKrw && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">적용 환율</label>
                                    <input required type="number" step="0.01" value={appliedRate} onChange={e => setAppliedRate(e.target.value)} className="w-full p-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                                </div>
                            )}
                        </>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">결제한 사람 (단일 선택)</label>
                        <div className="flex flex-wrap gap-1.5">
                            {allMembers.map(m => (
                                <button type="button" key={m} onClick={() => setPayer(m)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${payer === m ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-slate-50 text-slate-500'}`}>
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1.5">참여한 사람들 (다중 선택)</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {allMembers.map(m => {
                                const isSelected = participants.includes(m);
                                return (
                                    <button type="button" key={m} onClick={() => {
                                        const next = isSelected ? participants.filter(p => p !== m) : [...participants, m];
                                        setParticipants(next);
                                    }} className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${isSelected ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-400'}`}>
                                        {m} {isSelected && '✓'}
                                    </button>
                                );
                            })}
                        </div>

                        {/* 멤버 추가 입력창 */}
                        <div className="flex gap-2">
                            <input type="text" placeholder="참석자 추가" value={newMember} onChange={e => setNewMember(e.target.value)} className="flex-1 p-2 bg-slate-50 border rounded-xl text-xs outline-none" />
                            <button type="button" onClick={handleAddNewMember} className="bg-slate-900 text-white text-xs px-3 rounded-xl hover:bg-slate-800 transition-colors font-bold">추가</button>
                        </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 rounded-xl font-semibold text-sm">취소</button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm">저장</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------------
// [서브 컴포넌트] 여행지(프로젝트) 편집/삭제 모달
// ----------------------------------------------------------------------------
function TripEditModal({
                           trip, expenses, onClose, user, showToast
                       }: {
    trip: Trip, expenses: Expense[], onClose: () => void, user: User, showToast: (m: string, t?: 'success'|'error') => void
}) {
    const [title, setTitle] = useState(trip.title);
    const [startDate, setStartDate] = useState(trip.startDate || '');
    const [endDate, setEndDate] = useState(trip.endDate || '');
    const [isLoading, setIsLoading] = useState(false);

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            await updateDoc(getTripDoc(user.uid, trip.id), {
                title,
                startDate,
                endDate
            });
            showToast('✅ 여행지 정보가 수정되었습니다.');
            onClose();
        } catch (err: any) {
            showToast(`❌ 수정 실패: ${err.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('경고: 이 여행지를 삭제하시겠습니까?\n여행지를 삭제하면 관련된 모든 지출 내역도 함께 삭제되며 절대 복구할 수 없습니다!')) return;
        setIsLoading(true);
        try {
            // 1. 해당 여행지에 속한 모든 지출 내역 일괄 삭제 (캐스케이드 삭제 효과)
            const tripExpenses = expenses.filter(e => e.tripId === trip.id);
            for (const exp of tripExpenses) {
                await deleteDoc(getExpenseDoc(user.uid, exp.id));
            }

            // 2. 부모 여행지 문서 삭제
            await deleteDoc(getTripDoc(user.uid, trip.id));
            showToast('✅ 여행지와 관련된 모든 내역이 삭제되었습니다.');
            onClose();
        } catch (err: any) {
            showToast(`❌ 삭제 실패: ${err.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                    <h2 className="text-lg font-bold text-slate-800">여행지 정보 관리</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                </div>

                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">여행지 이름</label>
                        <input required type="text" value={title} onChange={e => setTitle(e.target.value)} className="w-full p-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>

                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-slate-500 mb-1">시작일 (선택)</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-600" />
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-bold text-slate-500 mb-1">종료일 (선택)</label>
                            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2.5 bg-slate-50 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm text-slate-600" />
                        </div>
                    </div>

                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 flex justify-between items-center mt-4">
                        <span className="text-xs font-bold text-rose-700">위험 구역</span>
                        <button type="button" onClick={handleDelete} disabled={isLoading} className="text-xs bg-rose-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-rose-700 transition-colors shadow-sm">
                            여행지 영구 삭제
                        </button>
                    </div>

                    <div className="flex gap-2 pt-2 border-t">
                        <button type="button" onClick={onClose} className="flex-1 py-3 bg-slate-100 rounded-xl font-semibold text-sm">취소</button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm">변경사항 저장</button>
                    </div>
                </form>
            </div>
        </div>
    );
}