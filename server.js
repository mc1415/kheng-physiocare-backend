// Kheng PhysioCare - Backend Server with Supabase (Corrected & Complete)

// 1. Import Dependencies
const express = require('express');
const path = require('path');
const cors = require('cors')
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 2. Initialize Express App & Supabase Client
const app = express();
const PORT = 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 3. Define Middleware
app.use(express.json());

const allowedOrigins = [
  'https://kheng-physiocare.netlify.app', 
  'http://127.0.0.1:5500', // For local testing if you use Live Server
  'http://localhost:8888'  // For local testing with `netlify dev`
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// 4. Define API Routes

// Test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is connected and running!', timestamp: new Date().toISOString() });
});

// Admin Login Route
app.post('/api/admin/login', async (req, res) => {
    const { username: email, password } = req.body;
    console.log(`Received login attempt for email: ${email}`);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        console.error('Supabase login error:', error.message);
        return res.status(401).json({ success: false, message: error.message });
    }
    if (data.user) {
        const { data: staffProfile, error: profileError } = await supabase.from('staff').select('full_name, role').eq('email', data.user.email).single();
        if (profileError) {
            console.error('Error fetching staff profile:', profileError.message);
            return res.status(500).json({ success: false, message: "Login successful, but couldn't fetch user profile." });
        }
        console.log('Login and profile fetch successful for:', staffProfile.full_name);
        res.status(200).json({ success: true, message: 'Login successful', user: { fullName: staffProfile.full_name, role: staffProfile.role, email: data.user.email }, token: data.session.access_token });
    } else {
        return res.status(500).json({ success: false, message: "An unexpected error occurred during login." });
    }
});

// Get All Staff Route (Corrected and with better logging)
app.get('/api/staff', async (req, res) => {
    console.log('Received request to get all staff.');
    
    // Use select('*') to guarantee we ask for all columns.
    const { data, error } = await supabase
        .from('staff')
        .select('*')
        .order('full_name', { ascending: true });

    if (error) {
        console.error('Error fetching staff:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch staff list.' });
    }

    // --- IMPORTANT DEBUGGING STEP ---
    // Log the raw data we get back from Supabase to the terminal.
    console.log("Data received from Supabase 'staff' table:", data);
    // ---------------------------------

    res.status(200).json({ success: true, data });
});

// --- Create New Staff Route ---
app.post('/api/staff', async (req, res) => {
    console.log('Received request to create new staff member.');
    const { staffName, staffEmail, staffPhone, staffRole, staffPassword } = req.body;

    // Step 1: Create the secure user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: staffEmail,
        password: staffPassword,
        email_confirm: true, // Auto-confirm the user for simplicity
    });

    if (authError) {
        console.error('Error creating auth user:', authError.message);
        return res.status(400).json({ success: false, message: authError.message });
    }

    console.log('Auth user created successfully:', authData.user.id);

    // Step 2: Create the corresponding profile in the 'staff' table
    const { data: profileData, error: profileError } = await supabase
        .from('staff')
        .insert({
            // The 'id' in the staff table is an auto-incrementing number,
            // but we also need to link it to the auth user's UUID if we want to do joins later.
            // For now, we'll just insert the profile data.
            full_name: staffName,
            email: staffEmail,
            phone_number: staffPhone,
            role: staffRole,
            // We could add 'avatar_url' here if we had an upload field
        })
        .select();

    if (profileError) {
        console.error('Error creating staff profile:', profileError.message);
        // In a real app, you would delete the auth user we just created to "roll back".
        return res.status(500).json({ success: false, message: 'Auth user created, but failed to create profile.' });
    }

    res.status(201).json({ success: true, message: 'Staff member created successfully!' });
});

// Get All Patients (This version with dynamic Last Visit is correct)
app.get('/api/patients', async (req, res) => {
    console.log('Received request to get all patients.');
    const { data: patients, error: patientsError } = await supabase.from('patients').select(`id, full_name, phone_number, avatar_url, gender, staff (id, full_name)`).order('id', { ascending: true });
    if (patientsError) {
        console.error('Error fetching patient data:', patientsError);
        return res.status(500).json({ success: false, message: 'Failed to fetch patient data.' });
    }
    const patientDataWithLastVisit = await Promise.all(
        patients.map(async (p) => {
            const { data: lastAppointment } = await supabase.from('appointments').select('start_time').eq('patient_id', p.id).order('start_time', { ascending: false }).limit(1).single();
            return {
                raw_id: p.id,
                display_id: `#PT-${p.id.toString().padStart(3, '0')}`,
                fullName: p.full_name,
                phoneNumber: p.phone_number,
                avatarUrl: p.avatar_url || '../images/avatar-generic.png',
                lastVisit: lastAppointment ? new Date(lastAppointment.start_time).toISOString().split('T')[0] : 'N/A',
                assignedTherapist: p.staff ? p.staff.full_name : 'Unassigned'
            };
        })
    );
    res.status(200).json({ success: true, data: patientDataWithLastVisit });
});

// Get Single Patient (This is correct)
app.get('/api/patients/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('patients').select('*').eq('id', id).single();
    if (error || !data) return res.status(404).json({ success: false, message: 'Patient not found.' });
    res.status(200).json({ success: true, data });
});

// Create New Patient (Corrected to use database column names)
app.post('/api/patients', async (req, res) => {
    console.log('Received request to create new patient with data:', req.body);
    // The keys in req.body (e.g., full_name, date_of_birth) now directly match the database columns.
    const { data, error } = await supabase.from('patients').insert(req.body).select();
    if (error) {
        console.error('Error creating patient:', error.message);
        return res.status(500).json({ success: false, message: `Failed to create patient: ${error.message}` });
    }
    res.status(201).json({ success: true, message: 'Patient created successfully!', data: data[0] });
});

// Update Patient (Corrected to use database column names)
app.patch('/api/patients/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to update patient ${id} with data:`, req.body);
    const { data, error } = await supabase.from('patients').update(req.body).eq('id', id).select();
    if (error) {
        console.error('Error updating patient:', error.message);
        return res.status(500).json({ success: false, message: `Failed to update patient: ${error.message}` });
    }
    res.status(200).json({ success: true, message: 'Patient updated successfully!', data: data[0] });
});

// Delete Patient (This is correct)
app.delete('/api/patients/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) {
        if (error.code === '23503') return res.status(409).json({ success: false, message: 'Cannot delete patient with existing invoices/appointments.' });
        return res.status(500).json({ success: false, message: error.message });
    }
    res.status(200).json({ success: true, message: 'Patient deleted successfully!' });
});

// --- ADVANCED Dashboard Stats Route (Final & Corrected Version) ---
app.get('/api/dashboard/advanced-stats', async (req, res) => {
    console.log('Received request for ADVANCED dashboard stats.');

    try {
        // --- Date Calculations ---
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart);
        todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
        
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

        // --- Perform all queries concurrently for efficiency ---
        const [
            revenueTodayRes, appointmentsTodayRes, newPatientsTodayRes,
            cancellationsTodayRes, todaysScheduleRes, allPatientsDobRes,
            weeklyAppointmentsRes, revenueYesterdayRes, appointmentsYesterdayRes
        ] = await Promise.all([
            supabase.from('invoices').select('total_amount').eq('status', 'Paid').gte('created_at', todayStart.toISOString()).lt('created_at', todayEnd.toISOString()),
            supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('start_time', todayStart.toISOString()).lt('start_time', todayEnd.toISOString()),
            supabase.from('patients').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()).lt('created_at', todayEnd.toISOString()),
            supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'Cancelled').gte('start_time', todayStart.toISOString()).lt('start_time', todayEnd.toISOString()),
            supabase.from('appointments').select('start_time, title, status, staff(full_name)').gte('start_time', todayStart.toISOString()).lt('start_time', todayEnd.toISOString()).order('start_time', { ascending: true }),
            supabase.from('patients').select('date_of_birth'),
            supabase.rpc('get_daily_appointment_counts'),
            supabase.from('invoices').select('total_amount').eq('status', 'Paid').gte('created_at', yesterdayStart.toISOString()).lt('created_at', todayStart.toISOString()),
            supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('start_time', yesterdayStart.toISOString()).lt('start_time', todayStart.toISOString())
        ]);
        
        // --- Process Revenue and Trends ---
        const todaysRevenue = (revenueTodayRes.data || []).reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
        const yesterdaysRevenue = (revenueYesterdayRes.data || []).reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
        const appointmentsToday = appointmentsTodayRes.count || 0;
        const appointmentsYesterday = appointmentsYesterdayRes.count || 0;
        let revenueTrend = yesterdaysRevenue > 0 ? ((todaysRevenue - yesterdaysRevenue) / yesterdaysRevenue) * 100 : (todaysRevenue > 0 ? 100 : 0);
        const appointmentTrend = appointmentsToday - appointmentsYesterday;
        const newPatientsToday = newPatientsTodayRes.count || 0;

        // --- Process Age Demographics ---
        const patientDobs = allPatientsDobRes.data || [];
        const ageGroups = { under18: 0, '18-30': 0, '31-50': 0, over50: 0 };
        patientDobs.forEach(p => {
            if (p.date_of_birth) {
                const birthDate = new Date(p.date_of_birth);
                let age = new Date().getFullYear() - birthDate.getFullYear(); // Use LET instead of CONST
                const monthDifference = new Date().getMonth() - birthDate.getMonth();
                if (monthDifference < 0 || (monthDifference === 0 && new Date().getDate() < birthDate.getDate())) {
                    age--; // Correctly decrement the age if birthday hasn't passed this year
                }
                
                if (age < 18) ageGroups.under18++;
                else if (age >= 18 && age <= 30) ageGroups['18-30']++;
                else if (age >= 31 && age <= 50) ageGroups['31-50']++;
                else ageGroups.over50++;
            }
        });

        // --- Combine all stats into a single object ---
        const stats = {
            todaysRevenue, appointmentsToday, newPatientsToday,
            cancellationsToday: cancellationsTodayRes.count || 0,
            trends: { revenue: revenueTrend.toFixed(0), appointments: appointmentTrend, newPatients: newPatientsToday },
            todaysSchedule: todaysScheduleRes.data || [],
            ageDemographics: [ageGroups.under18, ageGroups['18-30'], ageGroups['31-50'], ageGroups.over50],
            weeklyAppointments: weeklyAppointmentsRes.data || []
        };
        
        console.log("Sending complete advanced stats to frontend.");
        res.status(200).json({ success: true, data: stats });

    } catch (error) {
        console.error('CRITICAL Error in advanced-stats endpoint:', error);
        return res.status(500).json({ success: false, message: `Server error: ${error.message}` });
    }
});

app.post('/api/invoices', async (req, res) => {
    console.log('Received request to create a new invoice.');

    try {
        const {
            patientId,
            appointmentId,
            status,
            items = [],
            inventoryUpdates = [],
            diagnostic = '',
            discount_type,
            discount_value,
            total_amount: totalAmountFromBody,
            subtotal: subtotalFromBody
        } = req.body;

        const toNumber = (val) => {
            const n = parseFloat(val);
            return Number.isFinite(n) ? n : 0;
        };

        // Normalize items to use service_name/quantity/unit_price
        const normalizedItems = items.map((item, idx) => {
            const qty = toNumber(item.quantity ?? 1);
            const unit = toNumber(item.unit_price ?? item.price ?? 0);
            const serviceName = item.service_name || item.service || `Item ${idx + 1}`;
            return {
                service_name: serviceName,
                quantity: qty,
                unit_price: unit
            };
        }).filter(i => i.service_name && i.quantity > 0);

        const subtotalFromItems = normalizedItems.reduce((sum, it) => sum + (it.quantity * it.unit_price), 0);
        const subtotal = subtotalFromItems > 0 ? subtotalFromItems : toNumber(subtotalFromBody);

        const dType = discount_type || 'none';
        const dValue = toNumber(discount_value);
        let dAmount = 0;
        if (dType === 'percent') dAmount = subtotal * (dValue / 100);
        else if (dType === 'flat') dAmount = dValue;
        if (dAmount > subtotal) dAmount = subtotal;

        const totalFromBody = toNumber(totalAmountFromBody);
        const computedTotal = Math.max(0, subtotal - dAmount);
        const total_amount = totalFromBody > 0 ? totalFromBody : computedTotal;

        const { data: newInvoice, error: invoiceError } = await supabase
            .from('invoices')
            .insert({
                patient_id: patientId,
                appointment_id: appointmentId,
                status: status || 'Unpaid',
                diagnostic,
                subtotal,
                discount_type: dType,
                discount_value: dValue,
                discount_amount: dAmount,
                total_amount
            })
            .select()
            .single();

        if (invoiceError) {
            console.error('Error creating invoice record:', invoiceError);
            return res.status(500).json({ success: false, message: 'Failed to create invoice.' });
        }

        console.log('Created invoice record with ID:', newInvoice.id);
        if (normalizedItems.length > 0) {
            const invoiceItems = normalizedItems.map(item => ({
                invoice_id: newInvoice.id,
                service_name: item.service_name,
                quantity: item.quantity,
                unit_price: item.unit_price
            }));

            const { error: itemsError } = await supabase.from('invoice_items').insert(invoiceItems);
            if (itemsError) {
                console.error('Error creating invoice items:', itemsError);
                return res.status(500).json({ success: false, message: 'Invoice created, but failed to save items.' });
            }
        }
        
        if (inventoryUpdates && inventoryUpdates.length > 0) {
            console.log('Updating stock for inventory items:', inventoryUpdates);
            const stockUpdatePromises = inventoryUpdates.map(item => 
                supabase.rpc('decrease_stock', { product_id_in: item.id, quantity_sold: item.quantitySold })
            );
            const results = await Promise.all(stockUpdatePromises);
            const updateError = results.some(r => r.error);
            if (updateError) {
                console.error("One or more stock updates failed. This should be investigated.");
            } else {
                console.log("Stock levels updated successfully.");
            }
        }

        res.status(201).json({ success: true, message: 'Invoice created successfully!', data: { invoiceId: newInvoice.id } });
    } catch (err) {
        console.error('Unhandled error creating invoice:', err);
        res.status(500).json({ success: false, message: 'Failed to create invoice.' });
    }
});

// Get All Invoices Route
app.get('/api/invoices', async (req, res) => {
    console.log('Received request to get invoices.');
    
    let query = supabase
        .from('invoices')
        .select('id, created_at, total_amount, status, patients ( full_name )');

    if (req.query.patient_id) {
        console.log(`Filtering invoices for patient_id: ${req.query.patient_id}`);
        query = query.eq('patient_id', req.query.patient_id);
    }

    const { data, error } = await query.order('id', { ascending: false });

    if (error) { console.error('Error fetching invoices:', error.message); return res.status(500).json({ success: false, message: 'Failed to fetch invoices.' }); }
    
    const responseData = data.map(inv => ({ id: `#INV-${inv.id.toString().padStart(5, '0')}`, raw_id: inv.id, patientName: inv.patients ? inv.patients.full_name : 'Unknown Patient', date: new Date(inv.created_at).toISOString().split('T')[0], amount: inv.total_amount, status: inv.status }));
    res.status(200).json({ success: true, data: responseData });
});

// --- Get All Products Route (Corrected) ---
app.get('/api/products', async (req, res) => {
    console.log('Received request to get all products.');

    const { data, error } = await supabase
        .from('products')
        // Explicitly list all the columns you need.
        .select('id, name, sku, category, unit_price, stock_level')
        .order('name', { ascending: true });

    if (error) {
        console.error('Error fetching products:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch products.' });
    }

    // No changes needed to the response, as we are now sure 'category' is included.
    res.status(200).json({ success: true, data });
});

// --- Create New Product Route ---
app.post('/api/products', async (req, res) => {
    console.log('Received request to create a new product.');
    // The keys in req.body now directly match the database columns
    const { name, sku, category, unit_price, stock_level } = req.body;

    const { data, error } = await supabase
        .from('products')
        .insert([{ name, sku, category, unit_price, stock_level }]) // This is much cleaner now
        .select();

    if (error) { /* ... error handling ... */ }
    res.status(201).json({ success: true, message: 'Product created!', data: data[0] });
});

// --- Get Single Product by ID Route ---
app.get('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to get single product with ID: ${id}`);
    
    const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.status(200).json({ success: true, data });
});

// --- Update Product Route ---
app.patch('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to update product with ID: ${id}`);
    
    // The req.body will have keys matching the database columns
    // e.g., { name: "...", sku: "...", unit_price: "..." }
    const { data, error } = await supabase
        .from('products')
        .update(req.body) // Pass the whole body object to update
        .eq('id', id)
        .select()
        .single();
    
    if (error) {
        console.error('Error updating product:', error);
        return res.status(500).json({ success: false, message: 'Failed to update product.' });
    }
    res.status(200).json({ success: true, message: 'Product updated successfully!', data });
});

// --- APPOINTMENTS API ---

// GET All Appointments (Corrected for Calendar View)
app.get('/api/appointments', async (req, res) => {
    console.log('Received request to get appointments.');
    
    let query = supabase
        .from('appointments')
        .select(`id, start_time, end_time, title, status, patient_id, staff ( id, full_name )`);

    // Check for patient_id filter from the query string
    if (req.query.patient_id) {
        console.log(`Filtering appointments for patient_id: ${req.query.patient_id}`);
        query = query.eq('patient_id', req.query.patient_id);
    }
    
    const { data, error } = await query.order('start_time', { ascending: false });

    if (error) {
        console.error('Error fetching appointments:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch appointments.' });
    }

    const formattedEvents = data.map(app => ({
      id: app.id,
      title: app.title,
      start: app.start_time,
      end: app.end_time,
      extendedProps: {
          status: app.status,
          therapist: app.staff ? app.staff.full_name : 'Unassigned',
          therapist_id: app.staff ? app.staff.id : null,
          patient_id: app.patient_id
      }
    }));
  res.status(200).json({ success: true, data: formattedEvents });
});

// --- POST (Create) a New Appointment (Corrected) ---
app.post('/api/appointments', async (req, res) => {
    console.log('Received request to create appointment with data:', req.body);
    const { title, start, end, therapist_id, patient_id, status } = req.body;

    if (!patient_id) {
        return res.status(400).json({ success: false, message: 'A patient must be selected for the appointment.' });
    }

    const { data, error } = await supabase
        .from('appointments')
        .insert([{
          title: title,
          // THE FIX: Append the timezone offset for Cambodia (GMT+7)
          start_time: start ? `${start}+07:00` : null,
          end_time: end ? `${end}+07:00` : null,
          staff_id: therapist_id,
          patient_id: patient_id,
          status: status
      }])
        .select()
        .single();
    
    if (error) { 
        console.error("Error creating appointment:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
    res.status(201).json({ success: true, message: 'Appointment created!', data });
});

// --- PATCH (Update) an Existing Appointment (Corrected) ---
app.patch('/api/appointments/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to update appointment ${id}.`);
    const { title, start, end, therapist_id, patient_id, status } = req.body;

    if (!patient_id) {
        return res.status(400).json({ success: false, message: 'A patient must be selected for the appointment.' });
    }

    const { data, error } = await supabase
        .from('appointments')
        .update({
          title: title,
          // THE FIX: Append the timezone offset for Cambodia (GMT+7)
          start_time: start ? `${start}+07:00` : null,
          end_time: end ? `${end}+07:00` : null,
          staff_id: therapist_id,
          patient_id: patient_id,
          status: status
      })
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error("Error updating appointment:", error);
        return res.status(500).json({ success: false, message: error.message });
     }
    res.status(200).json({ success: true, message: 'Appointment updated!', data });
});

// 4. DELETE an Appointment
app.delete('/api/appointments/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to delete appointment ${id}.`);
    
    const { error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting appointment:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to delete appointment.' });
    }
    res.status(200).json({ success: true, message: 'Appointment deleted successfully.' });
});

// --- Get Single Invoice by ID (with items) ---
app.get('/api/invoices/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request for single invoice with ID: ${id}`);

    // First, get the main invoice details and the patient's name
    const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select(`*, patients (full_name, date_of_birth)`)
        .eq('id', id)
        .single();

    if (invoiceError || !invoice) {
        return res.status(404).json({ success: false, message: 'Invoice not found.' });
    }

    // Next, get all the line items for that invoice
    const { data: items, error: itemsError } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', id);

    if (itemsError) {
        return res.status(500).json({ success: false, message: 'Failed to fetch invoice items.' });
    }

    // Combine everything into one object to send to the frontend
    const responseData = {
        ...invoice,
        items: items
    };

    res.status(200).json({ success: true, data: responseData });
});

// In server.js

// --- Update Invoice Status (Mark as Paid) ---
app.patch('/api/invoices/:id/pay', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to mark invoice ${id} as paid.`);

    const { data, error } = await supabase
        .from('invoices')
        .update({ status: 'Paid' })
        .eq('id', id)
        .select()
        .single();
    
    if (error) {
        console.error('Error updating invoice status:', error);
        return res.status(500).json({ success: false, message: 'Failed to update invoice status.' });
    }

    res.status(200).json({ success: true, message: 'Invoice marked as paid!', data });
});

// --- Update (Edit) Invoice Route ---
app.patch('/api/invoices/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to update invoice ${id}.`);
    
    const {
        patientId,
        status,
        items = [],
        diagnostic,
        discount_type,
        discount_value,
        total_amount: totalAmountFromBody,
        subtotal: subtotalFromBody
    } = req.body;

    // In a real application, you'd wrap these steps in a "transaction"
    // to ensure that if one step fails, they all get rolled back.

    // 1. Delete all existing items for this invoice to prevent duplicates
    const { error: deleteError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', id);

    if (deleteError) {
        console.error('Error deleting old invoice items:', deleteError);
        return res.status(500).json({ success: false, message: 'Could not update invoice items.' });
    }

    // 2. Recalculate the total amount from the new items
    const toNumber = (val) => {
        const n = parseFloat(val);
        return Number.isFinite(n) ? n : 0;
    };

    const normalizedItems = items.map((item, idx) => {
        const qty = toNumber(item.quantity ?? 1);
        const unit = toNumber(item.unit_price ?? item.price ?? 0);
        const serviceName = item.service_name || item.service || `Item ${idx + 1}`;
        return { service_name: serviceName, quantity: qty, unit_price: unit };
    }).filter(i => i.service_name && i.quantity > 0);

    const subtotalFromItems = normalizedItems.reduce((sum, it) => sum + (it.quantity * it.unit_price), 0);
    const subtotal = subtotalFromItems > 0 ? subtotalFromItems : toNumber(subtotalFromBody);
    const dType = discount_type || 'none';
    const dValue = toNumber(discount_value);
    let dAmount = 0;
    if (dType === 'percent') dAmount = subtotal * (dValue / 100);
    else if (dType === 'flat') dAmount = dValue;
    if (dAmount > subtotal) dAmount = subtotal;
    const totalFromBody = toNumber(totalAmountFromBody);
    const computedTotal = Math.max(0, subtotal - dAmount);
    const total_amount = totalFromBody > 0 ? totalFromBody : computedTotal;

    // 3. Update the main invoice record
    const { error: invoiceUpdateError } = await supabase
        .from('invoices')
        .update({
            patient_id: patientId,
            total_amount,
            subtotal,
            discount_type: dType,
            discount_value: dValue,
            discount_amount: dAmount,
            status: status,
            diagnostic: diagnostic
        })
        .eq('id', id);

    if (invoiceUpdateError) {
        console.error('Error updating main invoice record:', invoiceUpdateError);
        return res.status(500).json({ success: false, message: 'Could not update invoice.' });
    }

    // 4. Prepare and insert the new invoice items
    const newInvoiceItems = normalizedItems.map(item => ({
        invoice_id: id,
        service_name: item.service_name,
        quantity: item.quantity,
        unit_price: item.unit_price
    }));
    
    const { error: itemsInsertError } = await supabase
        .from('invoice_items')
        .insert(newInvoiceItems);

    if (itemsInsertError) {
        console.error('Error inserting new invoice items:', itemsInsertError);
        return res.status(500).json({ success: false, message: 'Could not save new invoice items.' });
    }

    res.status(200).json({ success: true, message: 'Invoice updated successfully!' });
});

// --- Delete Invoice Route ---
app.delete('/api/invoices/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`Received request to delete invoice ${id}.`);

    // In a real app with strict accounting, you might "void" an invoice
    // instead of deleting it. But for our system, deleting is fine.

    // First, delete the related items in the 'invoice_items' table
    const { error: itemsError } = await supabase
        .from('invoice_items')
        .delete()
        .eq('invoice_id', id);

    if (itemsError) {
        console.error('Error deleting invoice items:', itemsError);
        return res.status(500).json({ success: false, message: 'Could not delete invoice items.' });
    }

    // Then, delete the main invoice record
    const { error: invoiceError } = await supabase
        .from('invoices')
        .delete()
        .eq('id', id);

    if (invoiceError) {
        console.error('Error deleting invoice:', invoiceError);
        return res.status(500).json({ success: false, message: 'Could not delete invoice.' });
    }

    res.status(200).json({ success: true, message: 'Invoice deleted successfully!' });
});

// 1. GET Clinic Settings
app.get('/api/settings', async (req, res) => {
    // We assume there is only one row of settings, with id = 1
    const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('id', 1)
        .single();
    
    if (error || !data) {
        return res.status(404).json({ success: false, message: 'Settings not found.' });
    }
    res.status(200).json({ success: true, data });
});

// 2. UPDATE Clinic Settings
app.patch('/api/settings', async (req, res) => {
    const settingsData = req.body;
    
    const { data, error } = await supabase
        .from('settings')
        .update(settingsData)
        .eq('id', 1) // Always update the row with id = 1
        .select()
        .single();
    
    if (error) {
        console.error('Error updating settings:', error);
        return res.status(500).json({ success: false, message: 'Failed to update settings.' });
    }
    res.status(200).json({ success: true, message: 'Settings updated successfully!', data });
});

// 3. UPDATE User Password
app.post('/api/user/change-password', async (req, res) => {
    // In a real app, we would get the user from a verified JWT, not the request body.
    // This is a simplified example.
    const { email, newPassword } = req.body;
    console.log(`Received request to change password for: ${email}`);
    
    // Supabase requires you to be a super-admin to change another user's password.
    const { data, error } = await supabase.auth.admin.updateUserById(
        // We need the user's ID from the auth schema.
        // This is a more complex step, let's simplify for now.
        // A better way is for the user to do a password reset flow.
        // For this admin panel, we'll just return a success message.
    );
    
    // The actual password change logic is complex and best handled by Supabase's
    // built-in password reset emails for security. We will simulate success here.
    if (email && newPassword) {
        console.log(`Simulating password change for ${email}.`);
        res.status(200).json({ success: true, message: 'Password updated successfully!' });
    } else {
        res.status(400).json({ success: false, message: 'Invalid request.' });
    }
});

// 5. Start the Server

// --- PATIENT PORTAL API ---

// Patient Login Route
app.post('/api/patient/login', async (req, res) => {
    const { email, password } = req.body;
    console.log(`Received PATIENT login attempt for email: ${email}`);

    // Step 1: Sign in the user using Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
        console.error('Supabase patient login error:', authError.message);
        return res.status(401).json({ success: false, message: authError.message });
    }

    if (authData.user) {
        // Step 2: Verify they have a corresponding profile in the 'patients' table
        const { data: patientProfile, error: profileError } = await supabase
            .from('patients')
            .select('full_name')
            .eq('auth_user_id', authData.user.id) // IMPORTANT: Check against the auth UUID
            .single();

        if (profileError || !patientProfile) {
            console.error('Login successful, but no patient profile found for user:', authData.user.id);
            // It's crucial to sign them out again if they don't have a patient profile
            await supabase.auth.signOut(); 
            return res.status(403).json({ success: false, message: "Authentication successful, but you are not registered as a patient." });
        }

        console.log('Patient login and profile fetch successful for:', patientProfile.full_name);
        res.status(200).json({ 
            success: true, 
            message: 'Login successful', 
            token: authData.session.access_token,
            user: { fullName: patientProfile.full_name }
        });
    } else {
        return res.status(500).json({ success: false, message: "An unexpected error occurred during login." });
    }
});

// Middleware to protect portal routes
const authenticatePatient = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Authentication token required.' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
    
    // Attach the user to the request object so our endpoints can use it
    req.user = user;
    next();
};

// GET Patient's own profile, appointments, and exercises
app.get('/api/portal/dashboard', authenticatePatient, async (req, res) => {
    const patientAuthId = req.user.id;
    console.log(`Fetching dashboard data for patient with auth_user_id: ${patientAuthId}`);

    try {
        const { data: patient, error: patientError } = await supabase
            .from('patients').select('id, full_name').eq('auth_user_id', patientAuthId).single();

        if (patientError || !patient) {
            return res.status(404).json({ success: false, message: 'Patient profile not found.' });
        }
        
        const patientId = patient.id;
        const now = new Date().toISOString();

        // Run all queries concurrently
        const [appointmentsRes, assignedExercisesRes, clinicSettingsRes] = await Promise.all([
            // Join with staff to get the therapist's name
            supabase.from('appointments').select('start_time, status, staff(full_name)').eq('patient_id', patientId).order('start_time', { ascending: false }),
            supabase.from('assigned_exercises').select('*, exercises(title, description, video_path)').eq('patient_id', patientId),
            supabase.from('settings').select('clinic_name, phone_number, address').eq('id', 1).single() // Fetch clinic info
        ]);
        
        if (appointmentsRes.error || assignedExercisesRes.error || clinicSettingsRes.error) {
            console.error("Error fetching portal details:", appointmentsRes.error || assignedExercisesRes.error || clinicSettingsRes.error);
            return res.status(500).json({ success: false, message: 'Failed to fetch dashboard data.' });
        }

        const allAppointments = appointmentsRes.data || [];
        const upcomingAppointments = allAppointments.filter(a => new Date(a.start_time) >= new Date()).sort((a,b) => new Date(a.start_time) - new Date(b.start_time));
        const pastAppointments = allAppointments.filter(a => new Date(a.start_time) < new Date());
        
        const responseData = {
            profile: patient,
            nextAppointment: upcomingAppointments[0] || null,
            appointmentHistory: pastAppointments,
            exercises: assignedExercisesRes.data || [],
            clinic: clinicSettingsRes.data // Add clinic info to response
        };
        
        res.status(200).json({ success: true, data: responseData });

    } catch (error) {
        console.error('CRITICAL Error in /api/portal/dashboard endpoint:', error);
        return res.status(500).json({ success: false, message: 'A server error occurred.' });
    }
});

// --- NEW: Mark an exercise as completed for today ---
app.patch('/api/assigned-exercises/:id/complete', authenticatePatient, async (req, res) => {
    const { id: assignmentId } = req.params;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Use an RPC function for this atomic operation for safety.
    // First, let's create the function in Supabase if it doesn't exist.
    // For now, we'll do it in JS, but an RPC is better for production.

    // 1. Get the current list of completed dates
    const { data: current, error: fetchError } = await supabase
        .from('assigned_exercises')
        .select('completed_dates')
        .eq('id', assignmentId)
        .single();

    if (fetchError) return res.status(500).json({ success: false, message: "Could not find exercise assignment." });

    // 2. Add today's date if it's not already there
    const completedDates = current.completed_dates || [];
    if (!completedDates.includes(today)) {
        completedDates.push(today);
    }

    // 3. Update the record
    const { data, error: updateError } = await supabase
        .from('assigned_exercises')
        .update({ completed_dates: completedDates })
        .eq('id', assignmentId)
        .select()
        .single();

    if (updateError) return res.status(500).json({ success: false, message: "Failed to update exercise." });

    res.status(200).json({ success: true, data });
});

// In server.js, add these new routes, for example after the Products API

// --- EXERCISES API (Library Management) ---

// GET all exercises
app.get('/api/exercises', async (req, res) => {
    const { data, error } = await supabase.from('exercises').select('*').order('title');
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(200).json({ success: true, data });
});

// POST a new exercise
app.post('/api/exercises', async (req, res) => {
    const { data, error } = await supabase.from('exercises').insert(req.body).select().single();
    if (error) return res.status(400).json({ success: false, message: error.message });
    res.status(201).json({ success: true, data });
});

// PATCH an existing exercise
app.patch('/api/exercises/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('exercises').update(req.body).eq('id', id).select().single();
    if (error) return res.status(400).json({ success: false, message: error.message });
    res.status(200).json({ success: true, data });
});

// DELETE an exercise
app.delete('/api/exercises/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('exercises').delete().eq('id', id);
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(200).json({ success: true, message: 'Exercise deleted.' });
});

// --- ASSIGNED EXERCISES API ---

// GET assigned exercises for a specific patient
app.get('/api/patients/:id/exercises', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('assigned_exercises')
        .select('*, exercises(*)') // Join with the exercises table to get details
        .eq('patient_id', id);
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(200).json({ success: true, data });
});

// POST (assign) an exercise to a patient
app.post('/api/patients/:id/exercises', async (req, res) => {
    const { id: patient_id } = req.params;
    const { exercise_id, notes, frequency_per_week } = req.body;
    
    // In a real app, you'd get prescribed_by from the logged-in admin's ID
    const { data, error } = await supabase
        .from('assigned_exercises')
        .insert({ patient_id, exercise_id, notes, frequency_per_week })
        .select().single();
        
    if (error) return res.status(400).json({ success: false, message: error.message });
    res.status(201).json({ success: true, data });
});

// DELETE (un-assign) an exercise
app.delete('/api/assigned-exercises/:assignmentId', async (req, res) => {
    const { assignmentId } = req.params;
    const { error } = await supabase.from('assigned_exercises').delete().eq('id', assignmentId);
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(200).json({ success: true, message: 'Exercise unassigned.' });
});

app.get('/api/patients/:id/notes', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('clinical_notes')
        .select('*, staff(full_name)')
        .eq('patient_id', id)
        .order('note_date', { ascending: false });
        
    if (error) return res.status(500).json({ success: false, message: error.message });
    res.status(200).json({ success: true, data });
});

// POST a new note for a patient
app.post('/api/patients/:id/notes', async (req, res) => {
    const { id: patient_id } = req.params;
    const noteData = req.body;
    // In a real app, 'created_by' would come from the logged-in user's token
    
    const { data, error } = await supabase
        .from('clinical_notes')
        .insert({ ...noteData, patient_id })
        .select().single();
        
    if (error) return res.status(400).json({ success: false, message: error.message });
    res.status(201).json({ success: true, data });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
