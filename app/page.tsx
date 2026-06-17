"use client";

import React, { useState, useMemo } from 'react';
import {
    Receipt, PlusCircle, Wallet, ArrowRightLeft, Trash2, Sparkles,
    Plane, Globe, Settings, ChevronLeft, Edit3, X, Coins, Plus
} from 'lucide-react';

// '오천엔', '50달러', '5000' 등 다양한 입력을 숫자로 변환
const parseMoney = (str) => {
    if (!str) return 0;
    // 각종 화폐 단위, 쉼표, 공백 제거
    const cleanStr = str.replace(/[,원엔달러유로위안바트페소\s]/g, '');
    if (/^\d+(\.\d+)?$/.test(cleanStr)) return parseFloat(cleanStr); // 소수점 지원

    const numMap = { '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9, '반': 0.5 };
    const unitMap = { '십': 10, '백': 100, '천': 1000 };

    let total = 0; let currentBlock = 0; let num = 0; let hasNum = false;

    for (let i = 0; i < cleanStr.length; i++) {
        const char = cleanStr[i];
        if (/\d/.test(char)) {
            let digitStr = char;
            while (i + 1 < cleanStr.length && /\d/.test(cleanStr[i+1])) {
                digitStr += cleanStr[i+1]; i++;
            }
            num = parseInt(digitStr, 10); hasNum = true;
        } else if (numMap[char]) {
            num = numMap[char]; hasNum = true;
        } else if (unitMap[char]) {
            if (!hasNum) num = 1;
            currentBlock += num * unitMap[char];
            num = 0; hasNum = false;
        } else if (char === '만') {
            if (!hasNum && currentBlock === 0) num = 1;
            total += (currentBlock + num) * 10000;
            currentBlock = 0; num = 0; hasNum = false;
        }
    }
    return total + currentBlock + num;
};

// 띄어쓰기 없는 '철수미애'도 분리, 새 참석자 인식
const extractMembers = (text, existingMembers) => {
    let found = [];
    let remainingText = text || '';

    const sortedMembers = [...existingMembers].sort((a, b) => b.length - a.length);
    sortedMembers.forEach(m => {
        if (remainingText.includes(m)) {
            found.push(m);
            remainingText = remainingText.replace(m, ' ');
        }
    });

    const ignoreWords = ['결제', '참석', '참여'];
    const newMembers = remainingText.split(/[\s,/]+/)
        .map(w => w.trim())
        .filter(w => w.length > 0 && !ignoreWords.includes(w));

    return [...found, ...newMembers];
};

export default function App() {
    // 여행지 목록 상태
    const [trips, setTrips] = useState([
        { id: 1, name: '오사카 먹방여행 🍡', currency: 'JPY', rate: 8.9, members: ['철수', '영희', '민수'] },
        { id: 2, name: '주말 강남 모임 🍻', currency: 'KRW', rate: 1, members: ['철수', '미애'] }
    ]);

    const [currentTripId, setCurrentTripId] = useState(null); // null이면 여행지 목록 보기

    // 전체 가계부 내역
    const [expenses, setExpenses] = useState([
        { id: 1, tripId: 1, date: '2026-06-17', description: '이치란 라멘', localAmount: 3000, appliedRate: 8.9, amount: 26700, payer: '철수', participants: ['철수', '영희', '민수'] },
        { id: 2, tripId: 1, date: '2026-06-17', description: '돈키호테 간식', localAmount: 5000, appliedRate: 8.9, amount: 44500, payer: '영희', participants: ['철수', '영희'] },
        { id: 3, tripId: 2, date: '2026-06-15', description: '삼겹살', localAmount: 60000, appliedRate: 1, amount: 60000, payer: '미애', participants: ['철수', '미애'] },
    ]);

    // UI 상태 관리
    const [activeTab, setActiveTab] = useState('input');
    const [smartText, setSmartText] = useState('');

    // 모달 상태 관리
    const [tripModal, setTripModal] = useState({ isOpen: false, mode: 'create', data: null });
    const [expenseModal, setExpenseModal] = useState({ isOpen: false, data: null });

    // 현재 활성화된 여행지 객체
    const currentTrip = useMemo(() => trips.find(t => t.id === currentTripId), [trips, currentTripId]);

    // 현재 여행지의 지출 내역
    const currentExpenses = useMemo(() => expenses.filter(e => e.tripId === currentTripId).sort((a,b) => b.id - a.id), [expenses, currentTripId]);

    const parsedData = useMemo(() => {
        if (!currentTrip) return { isValid: false };
        const lines = smartText.split('\n').map(l => l.trim()).filter(Boolean);
        let result = { payer: '', participants: [], localAmount: 0, appliedRate: currentTrip.rate, amount: 0, description: '', isValid: false };

        if (lines.length > 0) {
            result.participants = extractMembers(lines[0], currentTrip.members);
            if (result.participants.length > 0) result.payer = result.participants[0];
        }
        if (lines.length > 1) {
            let amtStr = lines[1];
            let rateToUse = currentTrip.rate;

            if (amtStr.includes('@')) {
                const parts = amtStr.split('@');
                amtStr = parts[0];
                const parsedRate = parseFloat(parts[1].replace(/[^0-9.]/g, ''));
                if (!isNaN(parsedRate)) rateToUse = parsedRate;
            }

            result.localAmount = parseMoney(amtStr);
            result.appliedRate = rateToUse;
            // 설정된 환율을 곱해 원화(KRW) 금액 자동 계산
            result.amount = Math.round(result.localAmount * result.appliedRate);
        }
        if (lines.length > 2) {
            result.description = lines.slice(2).join(' ');
        }

        if (result.participants.length > 0 && result.localAmount > 0 && result.description) {
            result.isValid = true;
        }
        return result;
    }, [smartText, currentTrip]);

    const settlements = useMemo(() => {
        if (!currentTrip) return {};
        let balances = {};
        currentTrip.members.forEach(m => balances[m] = 0);

        currentExpenses.forEach(exp => {
            // 결제자는 돈을 받음 (+)
            if (balances[exp.payer] !== undefined) balances[exp.payer] += exp.amount;
            else balances[exp.payer] = exp.amount;

            // 참여자는 돈을 냄 (-)
            const splitAmount = exp.amount / exp.participants.length;
            exp.participants.forEach(p => {
                if (balances[p] !== undefined) balances[p] -= splitAmount;
                else balances[p] = -splitAmount;
            });
        });
        return balances;
    }, [currentExpenses, currentTrip]);

    const handleSmartSubmit = (e) => {
        e.preventDefault();
        if (!parsedData.isValid) return;

        // 새로운 멤버가 있다면 해당 여행지 멤버 풀에 추가
        const newMembersList = [...new Set([...currentTrip.members, ...parsedData.participants])];
        if (newMembersList.length !== currentTrip.members.length) {
            setTrips(trips.map(t => t.id === currentTrip.id ? { ...t, members: newMembersList } : t));
        }

        const expense = {
            id: Date.now(),
            tripId: currentTrip.id,
            date: new Date().toISOString().split('T')[0],
            description: parsedData.description,
            localAmount: parsedData.localAmount,
            appliedRate: parsedData.appliedRate,
            amount: parsedData.amount, // 환율이 적용된 원화
            payer: parsedData.payer,
            participants: parsedData.participants
        };

        setExpenses([...expenses, expense]);
        setSmartText('');
        setActiveTab('list');
    };

    const handleSaveExpenseEdit = (e) => {
        e.preventDefault();
        const data = expenseModal.data;

        // 금액과 환율 파싱
        const numLocalAmount = parseFloat(data.localAmount) || 0;
        const numRate = parseFloat(data.appliedRate) || currentTrip.rate;
        const recalculatedKrwAmount = Math.round(numLocalAmount * numRate);

        setExpenses(expenses.map(exp => exp.id === data.id ? {
            ...exp,
            description: data.description,
            localAmount: numLocalAmount,
            appliedRate: numRate,
            amount: recalculatedKrwAmount,
            payer: data.payer,
            participants: data.participants
        } : exp));

        setExpenseModal({ isOpen: false, data: null });
    };

    const deleteExpense = (id) => {
        if(window.confirm("이 내역을 삭제하시겠습니까?")) {
            setExpenses(expenses.filter(exp => exp.id !== id));
        }
    };

    const handleSaveTrip = (e) => {
        e.preventDefault();
        const data = tripModal.data;
        const numRate = parseFloat(data.rate) || 1;

        if (tripModal.mode === 'create') {
            const newTrip = {
                id: Date.now(),
                name: data.name,
                currency: data.currency.toUpperCase(),
                rate: numRate,
                members: ['나'] // 기본 멤버
            };
            setTrips([newTrip, ...trips]);
        } else {
            // 환율 일괄 수정 옵션 적용
            setTrips(trips.map(t => t.id === data.id ? { ...t, name: data.name, currency: data.currency.toUpperCase(), rate: numRate } : t));

            // 일괄 덮어쓰기 체크박스가 켜져있다면 해당 여행지의 모든 기존 지출 내역의 환율과 원화 금액 일괄 업데이트
            if (data.applyToAll) {
                setExpenses(expenses.map(exp => {
                    if (exp.tripId === data.id) {
                        return { ...exp, appliedRate: numRate, amount: Math.round(exp.localAmount * numRate) };
                    }
                    return exp;
                }));
            }
        }
        setTripModal({ isOpen: false, mode: 'create', data: null });
    };


    const renderTripList = () => (
        <div className="p-4 flex flex-col h-full overflow-y-auto pb-24">
            <div className="flex justify-between items-center mb-6 mt-2">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">나의 여행지</h2>
                    <p className="text-slate-500 text-sm mt-1">어디서 정산을 시작할까요?</p>
                </div>
            </div>

            <div className="space-y-4">
                {trips.map(trip => {
                    const tripExpenses = expenses.filter(e => e.tripId === trip.id);
                    const totalKrw = tripExpenses.reduce((sum, exp) => sum + exp.amount, 0);

                    return (
                        <button
                            key={trip.id}
                            onClick={() => { setCurrentTripId(trip.id); setActiveTab('input'); }}
                            className="w-full text-left bg-white p-5 rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-100 hover:border-indigo-300 hover:shadow-md transition-all group relative overflow-hidden"
                        >
                            <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-50 rounded-bl-full -z-10 group-hover:bg-indigo-100 transition-colors"></div>
                            <div className="flex justify-between items-start mb-3">
                                <h3 className="font-bold text-lg text-slate-800">{trip.name}</h3>
                                <span className="flex items-center gap-1 text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                  <Globe size={12}/> {trip.currency}
                </span>
                            </div>
                            <div className="flex items-end justify-between">
                                <div>
                                    <p className="text-xs text-slate-400 mb-1">총 지출 금액 (환율 적용)</p>
                                    <p className="font-extrabold text-xl text-indigo-600">{totalKrw.toLocaleString()}원</p>
                                </div>
                                <div className="flex -space-x-2">
                                    {trip.members.slice(0, 3).map((m, i) => (
                                        <div key={i} className="w-8 h-8 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center text-xs font-bold text-slate-600 shadow-sm">{m[0]}</div>
                                    ))}
                                    {trip.members.length > 3 && (
                                        <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-xs font-bold text-slate-500 shadow-sm">+{trip.members.length - 3}</div>
                                    )}
                                </div>
                            </div>
                        </button>
                    )
                })}

                <button
                    onClick={() => setTripModal({ isOpen: true, mode: 'create', data: { name: '', currency: 'USD', rate: 1400 } })}
                    className="w-full border-2 border-dashed border-slate-200 text-slate-500 font-bold py-5 rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
                >
                    <Plus size={20} /> 새 여행지(모임) 추가하기
                </button>
            </div>
        </div>
    );

    const renderTripDetail = () => (
        <div className="flex flex-col h-full relative">
            {/* 상세 뷰 헤더 */}
            <header className="bg-indigo-600 text-white p-4 pb-6 shadow-md rounded-b-2xl z-20 sticky top-0">
                <div className="flex items-center justify-between mb-2">
                    <button onClick={() => setCurrentTripId(null)} className="p-1 hover:bg-indigo-500 rounded-lg transition-colors">
                        <ChevronLeft size={24} />
                    </button>
                    <h1 className="text-lg font-bold flex-1 text-center truncate px-2">{currentTrip.name}</h1>
                    <button
                        onClick={() => setTripModal({ isOpen: true, mode: 'edit', data: currentTrip })}
                        className="p-1 hover:bg-indigo-500 rounded-lg transition-colors"
                    >
                        <Settings size={20} />
                    </button>
                </div>
                <div className="flex justify-center items-center gap-2 text-indigo-100 text-xs font-medium">
                    <Coins size={14}/>
                    <span>기준 환율: 1 {currentTrip.currency} = {currentTrip.rate} 원</span>
                </div>
            </header>

            {/* 탭 콘텐츠 영역 */}
            <main className="flex-1 p-4 overflow-y-auto pb-24 bg-slate-50">

                {/* 1. 마법 입력 탭 */}
                {activeTab === 'input' && (
                    <div className="animate-in fade-in duration-300 flex flex-col h-full">
                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <Sparkles className="text-indigo-600" size={20} />
                            마법 자동 입력
                        </h2>

                        <div className="bg-white p-2 rounded-2xl border border-slate-100 shadow-[0_4px_15px_rgba(0,0,0,0.02)] flex flex-col">
                            <div className="bg-slate-50 p-4 rounded-xl mb-3 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                                💡 <span className="font-bold text-slate-800">참석자, 금액, 내용</span>을 줄바꿈으로 입력하세요.{"\n"}
                                (금액 뒤에 <span className="font-bold text-indigo-600">@환율</span>을 적으면 개별 환율이 적용됩니다. 예: 5000@9.5)
                            </div>

                            <textarea
                                className="w-full flex-1 min-h-[160px] p-4 bg-slate-50/50 border-2 border-slate-100 rounded-xl focus:outline-none focus:border-indigo-400 transition-all resize-none text-lg leading-relaxed text-slate-800 placeholder-slate-300"
                                placeholder={`철수미애 (가장 앞사람이 결제자)\n5000 (또는 5000@9.5)\n저녁 식사`}
                                value={smartText}
                                onChange={e => setSmartText(e.target.value)}
                            />

                            {/* 파싱 결과 실시간 프리뷰 */}
                            <div className="mt-3 bg-white border border-indigo-50 p-4 rounded-xl shadow-sm">
                                <div className="flex items-center justify-between mb-3 border-b border-slate-50 pb-2">
                                    <span className="text-xs font-bold text-slate-400 tracking-wider">자동 인식 결과</span>
                                    {parsedData.isValid && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full animate-pulse">등록 가능</span>}
                                </div>
                                <div className="space-y-1.5 text-sm">
                                    <div className="flex justify-between"><span className="text-slate-400 w-12">결제</span> <span className="font-bold text-indigo-600">{parsedData.payer || '-'}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-400 w-12">참석</span> <span className="font-medium text-slate-700 text-right">{parsedData.participants.join(', ') || '-'}</span></div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-400 w-12">금액</span>
                                        <div className="text-right">
                                            <span className="font-bold text-slate-800 text-base">{parsedData.localAmount > 0 ? parsedData.localAmount.toLocaleString() : '0'} {currentTrip.currency}</span>
                                            {currentTrip.currency !== 'KRW' && parsedData.localAmount > 0 && (
                                                <span className="block text-[10px] text-slate-400">≈ {parsedData.amount.toLocaleString()}원 (환율 {parsedData.appliedRate})</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex justify-between"><span className="text-slate-400 w-12">내용</span> <span className="text-slate-800 truncate">{parsedData.description || '-'}</span></div>
                                </div>

                                <button
                                    onClick={handleSmartSubmit}
                                    disabled={!parsedData.isValid}
                                    className={`w-full font-bold py-3 rounded-xl mt-4 transition-all ${
                                        parsedData.isValid
                                            ? 'bg-indigo-600 text-white shadow-md hover:bg-indigo-700 active:scale-95'
                                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                    }`}
                                >
                                    입력 완료 (Enter)
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 2. 내역 리스트 탭 */}
                {activeTab === 'list' && (
                    <div className="animate-in fade-in duration-300">
                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <Receipt className="text-indigo-600" size={20} />
                            지출 내역
                        </h2>
                        {currentExpenses.length === 0 ? (
                            <div className="text-center text-slate-400 py-12 bg-white rounded-2xl border border-slate-100">
                                아직 등록된 내역이 없습니다.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {currentExpenses.map(exp => (
                                    <div key={exp.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex flex-col group">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md">
                          {exp.payer} 결제
                        </span>
                                                <span className="text-xs text-slate-400">{exp.date}</span>
                                            </div>
                                            <div className="flex gap-1">
                                                <button onClick={() => setExpenseModal({ isOpen: true, data: exp })} className="text-slate-300 hover:text-indigo-500 p-1 transition-colors"><Edit3 size={16} /></button>
                                                <button onClick={() => deleteExpense(exp.id)} className="text-slate-300 hover:text-rose-500 p-1 transition-colors"><Trash2 size={16} /></button>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-end mt-1">
                                            <div>
                                                <p className="font-bold text-slate-800 text-lg">{exp.description}</p>
                                                <p className="text-xs text-slate-500 mt-1">
                                                    함께: {exp.participants.join(', ')}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-extrabold text-lg text-slate-800">
                                                    {exp.localAmount.toLocaleString()} <span className="text-sm font-semibold">{currentTrip.currency}</span>
                                                </p>
                                                {currentTrip.currency !== 'KRW' && (
                                                    <p className="text-xs text-slate-400 font-medium">
                                                        {exp.amount.toLocaleString()} 원 <span className="text-[10px]">(환율 {exp.appliedRate || currentTrip.rate})</span>
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* 3. 정산 현황 탭 */}
                {activeTab === 'settlement' && (
                    <div className="animate-in fade-in duration-300">
                        <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                            <ArrowRightLeft className="text-indigo-600" size={20} />
                            최종 정산 현황
                        </h2>
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-6">
                            <div className="bg-indigo-50 p-4 border-b border-indigo-100">
                                <p className="text-sm text-indigo-800 font-medium text-center">
                                    최종적으로 <span className="font-bold">원화(KRW) 기준</span> 누가 얼마를 주고받아야 하는지 보여줍니다.
                                </p>
                            </div>
                            <div className="p-2">
                                {Object.entries(settlements).map(([member, balance]) => (
                                    <div key={member} className="flex items-center justify-between p-4 border-b border-slate-50 last:border-0">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">
                                                {member[0]}
                                            </div>
                                            <span className="font-semibold text-slate-800 text-lg">{member}</span>
                                        </div>
                                        <div className="text-right">
                                            {balance > 0 ? (
                                                <span className="text-emerald-600 font-bold bg-emerald-50 px-3 py-1.5 rounded-full inline-block">
                          +{Math.round(balance).toLocaleString()}원 받을 돈
                        </span>
                                            ) : balance < 0 ? (
                                                <span className="text-rose-600 font-bold bg-rose-50 px-3 py-1.5 rounded-full inline-block">
                          {Math.round(balance).toLocaleString()}원 보낼 돈
                        </span>
                                            ) : (
                                                <span className="text-slate-400 font-medium px-3 py-1.5">정산 완료</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* 하단 네비게이션 탭 */}
            <nav className="absolute bottom-0 w-full bg-white border-t border-slate-100 flex justify-around p-2 pb-6 z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
                <button onClick={() => setActiveTab('input')} className={`flex flex-col items-center p-2 w-20 rounded-xl transition-all ${activeTab === 'input' ? 'text-indigo-600 font-bold bg-indigo-50' : 'text-slate-400 hover:text-slate-600'}`}>
                    <PlusCircle size={22} className="mb-1" /> <span className="text-[10px]">입력</span>
                </button>
                <button onClick={() => setActiveTab('list')} className={`flex flex-col items-center p-2 w-20 rounded-xl transition-all ${activeTab === 'list' ? 'text-indigo-600 font-bold bg-indigo-50' : 'text-slate-400 hover:text-slate-600'}`}>
                    <Receipt size={22} className="mb-1" /> <span className="text-[10px]">내역</span>
                </button>
                <button onClick={() => setActiveTab('settlement')} className={`flex flex-col items-center p-2 w-20 rounded-xl transition-all ${activeTab === 'settlement' ? 'text-indigo-600 font-bold bg-indigo-50' : 'text-slate-400 hover:text-slate-600'}`}>
                    <Wallet size={22} className="mb-1" /> <span className="text-[10px]">정산결과</span>
                </button>
            </nav>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-200 sm:py-6 flex justify-center font-sans">
            <div className="w-full max-w-md bg-white sm:rounded-3xl shadow-2xl relative flex flex-col overflow-hidden h-[100dvh] sm:h-[850px]">

                {/* 라우팅 흉내내기: currentTripId 여부에 따라 화면 전환 */}
                {!currentTripId ? renderTripList() : renderTripDetail()}

                {/* 여행지 설정 모달 */}
                {tripModal.isOpen && (
                    <div className="absolute inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center animate-in fade-in">
                        <div className="bg-white w-full h-[80%] sm:h-auto sm:max-h-[90%] rounded-t-3xl sm:rounded-3xl p-6 flex flex-col animate-in slide-in-from-bottom-10">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold">{tripModal.mode === 'create' ? '새 여행지 추가' : '여행지 설정 (환율 일괄수정)'}</h3>
                                <button onClick={() => setTripModal({ isOpen: false, data: null })} className="p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"><X size={20}/></button>
                            </div>
                            <form onSubmit={handleSaveTrip} className="space-y-4 overflow-y-auto pb-4 flex-1">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">여행/모임 이름</label>
                                    <input required type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-medium" value={tripModal.data.name} onChange={e => setTripModal({ ...tripModal, data: { ...tripModal.data, name: e.target.value }})} placeholder="예) 오사카 먹방여행" />
                                </div>
                                <div className="flex gap-4">
                                    <div className="flex-1">
                                        <label className="block text-sm font-bold text-slate-700 mb-1">사용 통화</label>
                                        <input required type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-medium uppercase" value={tripModal.data.currency} onChange={e => setTripModal({ ...tripModal, data: { ...tripModal.data, currency: e.target.value }})} placeholder="USD, JPY 등" />
                                    </div>
                                    <div className="flex-1">
                                        <label className="block text-sm font-bold text-slate-700 mb-1">기준 환율</label>
                                        <input required type="number" step="any" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-medium" value={tripModal.data.rate} onChange={e => setTripModal({ ...tripModal, data: { ...tripModal.data, rate: e.target.value }})} placeholder="예) 1400" />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 bg-indigo-50 p-3 rounded-lg leading-relaxed">
                                    💡 1 {tripModal.data.currency || '통화'} 당 원화(KRW) 금액을 입력하세요.<br/>
                                    (예: 달러는 1400, 엔화는 8.9, 원화는 1)
                                </p>
                                {tripModal.mode === 'edit' && (
                                    <label className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-100 rounded-xl cursor-pointer">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 text-rose-600 rounded border-rose-300 focus:ring-rose-500"
                                            checked={tripModal.data.applyToAll || false}
                                            onChange={e => setTripModal({ ...tripModal, data: { ...tripModal.data, applyToAll: e.target.checked }})}
                                        />
                                        <span className="text-sm font-bold text-rose-700">기존에 입력된 지출 내역의 환율도 모두 덮어쓰기</span>
                                    </label>
                                )}
                                <button type="submit" className="w-full py-4 mt-6 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors">저장하기</button>
                            </form>
                        </div>
                    </div>
                )}

                {/* 지출 내역 수정 모달 */}
                {expenseModal.isOpen && (
                    <div className="absolute inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center animate-in fade-in">
                        <div className="bg-white w-full h-[85%] sm:h-auto sm:max-h-[90%] rounded-t-3xl sm:rounded-3xl p-6 flex flex-col animate-in slide-in-from-bottom-10">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold">내역 수정</h3>
                                <button onClick={() => setExpenseModal({ isOpen: false, data: null })} className="p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200"><X size={20}/></button>
                            </div>
                            <form onSubmit={handleSaveExpenseEdit} className="space-y-5 overflow-y-auto pb-4 flex-1">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">사용처 (내용)</label>
                                    <input required type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500" value={expenseModal.data.description} onChange={e => setExpenseModal({ ...expenseModal, data: { ...expenseModal.data, description: e.target.value }})} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">결제 금액 ({currentTrip.currency})</label>
                                    <input required type="number" step="any" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-bold text-indigo-600" value={expenseModal.data.localAmount} onChange={e => setExpenseModal({ ...expenseModal, data: { ...expenseModal.data, localAmount: e.target.value }})} />
                                </div>
                                {currentTrip.currency !== 'KRW' && (
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">적용 환율</label>
                                        <input required type="number" step="any" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-indigo-500 font-medium" value={expenseModal.data.appliedRate || currentTrip.rate} onChange={e => setExpenseModal({ ...expenseModal, data: { ...expenseModal.data, appliedRate: e.target.value }})} />
                                        <p className="text-xs text-slate-400 mt-1 pl-1">이 내역에만 적용될 기준 환율입니다.</p>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">결제한 사람</label>
                                    <div className="flex flex-wrap gap-2">
                                        {currentTrip.members.map(m => (
                                            <button type="button" key={m} onClick={() => setExpenseModal({ ...expenseModal, data: { ...expenseModal.data, payer: m }})} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${expenseModal.data.payer === m ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200'}`}>{m}</button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-2">함께한 사람 (N:1 대상)</label>
                                    <div className="flex flex-wrap gap-2">
                                        {currentTrip.members.map(m => {
                                            const isSelected = expenseModal.data.participants.includes(m);
                                            return (
                                                <button type="button" key={m} onClick={() => {
                                                    const newParts = isSelected ? expenseModal.data.participants.filter(p => p !== m) : [...expenseModal.data.participants, m];
                                                    setExpenseModal({ ...expenseModal, data: { ...expenseModal.data, participants: newParts }});
                                                }} className={`px-4 py-2 rounded-full text-sm font-bold transition-all border ${isSelected ? 'bg-indigo-50 text-indigo-700 border-indigo-300' : 'bg-white text-slate-400 border-slate-200'}`}>
                                                    {m} {isSelected && '✓'}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <button type="submit" className="w-full py-4 mt-4 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-lg">수정 완료</button>
                            </form>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}