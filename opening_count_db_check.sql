\set ON_ERROR_STOP 1
begin;
do $$
declare
  m1 text := gen_random_uuid()::text; m2 text := gen_random_uuid()::text;
  c  text := gen_random_uuid()::text; l1 text := gen_random_uuid()::text; l2 text := gen_random_uuid()::text;
  c2 text := gen_random_uuid()::text; l3 text := gen_random_uuid()::text;
  b record; n int;
begin
  insert into materials (id, code, name, uom, "stockType", "updatedAt") values
    (m1,'M1','22 SWG Copper Wire','KG','PER_JOB',now()), (m2,'M2','Ferrite Core E-30','NOS','PER_JOB',now());
  insert into stock_counts (id, number, "countDate", "isOpening", "updatedAt") values (c,'CNT-O',now(),true,now());
  insert into stock_count_lines (id,"stockCountId","materialId","systemQty","countedQty","differenceQty","unitRate")
    values (l1,c,m1,0,145,145,812), (l2,c,m2,0,18,18,null);

  begin update stock_counts set status='PENDING_APPROVAL' where id=c; raise exception 'FAIL: submitted with a missing rate';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; if sqlerrm not like 'COUNT_INCOMPLETE%' then raise exception 'FAIL wrong error: %', sqlerrm; end if; end;
  raise notice 'PASS missing rate blocks submission (%)', 'COUNT_INCOMPLETE';

  begin update stock_count_lines set "unitRate"=0 where id=l2; raise exception 'FAIL: ₹0 rate accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  raise notice 'PASS ₹0 rate refused';

  update stock_count_lines set "unitRate"=65 where id=l2;   -- no invoice number: allowed
  update stock_counts set status='PENDING_APPROVAL' where id=c;
  raise notice 'PASS submits with rates and no invoice numbers';

  begin insert into stock_movements (id,"materialId",type,direction,quantity,rate,"movementDate",value,"balanceQtyAfter","balanceRateAfter","balanceValueAfter","stockCountLineId")
        values (gen_random_uuid()::text,m1,'OPENING','IN',145,812,now(),0,0,0,0,l1);
        raise exception 'FAIL: OPENING posted before approval';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  raise notice 'PASS no OPENING before approval';

  update stock_counts set status='APPROVED' where id=c;
  insert into stock_movements (id,"materialId",type,direction,quantity,rate,"movementDate",value,"balanceQtyAfter","balanceRateAfter","balanceValueAfter","stockCountLineId")
    values (gen_random_uuid()::text,m1,'OPENING','IN',145,812,now(),0,0,0,0,l1),
           (gen_random_uuid()::text,m2,'OPENING','IN',18,65,now(),0,0,0,0,l2);
  select * into b from stock_balances where "materialId"=m1;
  if b.quantity<>145 or b."averageRate"<>812 or b."stockValue"<>117740 then raise exception 'FAIL balance % % %',b.quantity,b."averageRate",b."stockValue"; end if;
  raise notice 'PASS wire in at 145 kg @ ₹812 = ₹1,17,740 (not ₹0)';

  begin insert into stock_movements (id,"materialId",type,direction,quantity,rate,"movementDate",value,"balanceQtyAfter","balanceRateAfter","balanceValueAfter","stockCountLineId")
        values (gen_random_uuid()::text,m1,'COUNT_ADJUSTMENT','IN',1,812,now(),0,0,0,0,l1);
        raise exception 'FAIL: adjustment against the opening count';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  raise notice 'PASS opening count cannot post adjustments';

  begin insert into stock_movements (id,"materialId",type,direction,quantity,rate,"movementDate",value,"balanceQtyAfter","balanceRateAfter","balanceValueAfter")
        values (gen_random_uuid()::text,m1,'OPENING','IN',1,1,now(),0,0,0,0);
        raise exception 'FAIL: OPENING with no count';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  raise notice 'PASS OPENING with no count refused (backdoor closed)';

  insert into stock_counts (id, number, "countDate", "isOpening", status, "updatedAt") values (c2,'CNT-O2',now(),true,'PENDING_APPROVAL',now());
  begin update stock_counts set status='APPROVED' where id=c2; raise exception 'FAIL: second opening approved';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; if sqlerrm not like 'OPENING_ALREADY_DONE%' then raise exception 'FAIL wrong error: %', sqlerrm; end if; end;
  raise notice 'PASS second opening count refused';

  -- a normal count still works, and IS in the leak report; the opening is not
  delete from stock_counts where id=c2;
  insert into stock_counts (id, number, "countDate", status, "updatedAt") values (c2,'CNT-N',now(),'PENDING_APPROVAL',now());
  insert into stock_count_lines (id,"stockCountId","materialId","systemQty","countedQty","differenceQty","reasonCode") values (l3,c2,m1,145,140,-5,'UNEXPLAINED');
  update stock_counts set status='APPROVED' where id=c2;
  insert into stock_movements (id,"materialId",type,direction,quantity,rate,"movementDate",value,"balanceQtyAfter","balanceRateAfter","balanceValueAfter","stockCountLineId")
    values (gen_random_uuid()::text,m1,'COUNT_ADJUSTMENT','OUT',5,812,now(),0,0,0,0,l3);
  select count(*) into n from v_material_leak;
  if n<>1 then raise exception 'FAIL leak rows %', n; end if;
  select unexplained_count into n from v_material_leak where material_id=m1;
  if n<>1 then raise exception 'FAIL unexplained %', n; end if;
  raise notice 'PASS leak report: only the monthly count shows (1 unexplained), opening excluded';

  select count(*) into n from v_balance_integrity;
  if n<>0 then raise exception 'FAIL integrity drift'; end if;
  raise notice 'PASS ledger and balances agree';
  raise notice 'ALL PASSED';
end $$;
rollback;
