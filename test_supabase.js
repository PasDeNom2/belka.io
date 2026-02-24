import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://tpmanwahkjcgdvzpmpex.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_dbX1Gfqwt4RmY6iGBEw_zA_Pr2xOIk-';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log("Testing insert...");
    const { data, error } = await supabase.from('pixels').insert({ x: 10, y: 10, color: 'blue' }).select();
    console.log("Insert result:", { data, error });

    console.log("Testing select...");
    const { data: d2, error: e2 } = await supabase.from('pixels').select('*').limit(5);
    console.log("Select result:", { data: d2, error: e2 });
}

test();
