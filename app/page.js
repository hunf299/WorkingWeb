'use client';

import {useEffect,useState} from 'react';
import {parseVNDate,parseSlot,isSameDay} from '../lib/parse';
import {buildICS} from '../lib/ics';

export default function Page(){
  const [todayEvents,setTodayEvents]=useState([]);
  const today=new Date();

  useEffect(()=>{
    fetch('/api/sheet').then(r=>r.json()).then(j=>{
      const list=j.items||[];
      const todayList=[];
      for(const it of list){
        const d=parseVNDate(it.rawDate);
        if(!d) continue;
        if(isSameDay(d,today)){
          const slot=parseSlot(it.timeSlot,d);
          if(!slot) continue;
          todayList.push({
            title: it.brandChannel,   // Summary = brandChannel
            start: slot.start,
            end: slot.end,
            location: it.room,
            desc:
`Session type: ${it.sessionType}
Talent: ${it.talent1}${it.talent2 ? ', ' + it.talent2 : ''}
Room: ${it.room}
Phone: ${it.phone}
Time slot: ${it.timeSlot}
Nguồn: Google Sheet ${it.rawDate}`
          });
        }
      }
      setTodayEvents(todayList);
    });
  },[]);

  function downloadICS(){
    if(!todayEvents.length){
      alert('Không có ca hôm nay');
      return;
    }
    const ics=buildICS(todayEvents);
    const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    const y=today.getFullYear();
    const m=String(today.getMonth()+1).padStart(2,'0');
    const d=String(today.getDate()).padStart(2,'0');
    a.href=url;
    a.download=`work-${y}${m}${d}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{padding:20,maxWidth:600,margin:"0 auto"}}>
      <h1>Lịch hôm nay ({today.toLocaleDateString('vi-VN')})</h1>
      {todayEvents.length?(
        <>
          <ul>
            {todayEvents.map((e,i)=>(
              <li key={i} style={{marginBottom:10}}>
                <b>{e.title}</b> ⏰ {e.start.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}
                – {e.end.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}
                <br/>
                <small>📍 {e.location} | {e.desc.split('\n')[0]}</small>
              </li>
            ))}
          </ul>
          <button
            onClick={downloadICS}
            style={{padding:'10px 20px',fontSize:16,marginTop:10,cursor:'pointer'}}
          >
            Tải lịch hôm nay (.ics)
          </button>
        </>
      ):<p>Không có sự kiện hôm nay.</p>}
    </div>
  );
}
